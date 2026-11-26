import {
  CHECKER_MEMORY_MB,
  CHECKER_TIME_MS,
  LANGUAGES,
  LIMITS,
  compareOutputs,
  overallVerdict,
  readCheckerResult,
  skipsCase,
  type Checker,
  type LanguageDefinition,
  type LanguageId,
  type SourceFile,
  type Verdict,
} from "@workspace/judge"

import type { ExecResult, Sandbox, SandboxBackend } from "./sandbox/types.ts"

const OOM_EXIT_CODE = 137
const BUILD_TIME_LIMIT_MS = 30_000
/** So one huge submission can't hold a runner slot indefinitely. */
const JOB_DEADLINE_MS = 5 * 60_000
const OUTPUT_PREVIEW_BYTES = 16 * 1024
const SANDBOX_DIED_MESSAGE =
  "Your program was stopped because it used too many processes or too much memory."

export interface JudgeCase {
  id?: string
  input: string
  /** Null for a plain run with custom input, which nothing is compared against. */
  expected: string | null
  /** Its test group: once one of a group's tests fails, the rest are skipped, not run. */
  group?: string | null
}

export interface JudgeRequest {
  language: LanguageId
  files: SourceFile[]
  entry: string
  cases: JudgeCase[]
  timeLimitMs: number
  memoryLimitMb: number
  /** How output is checked (packages/judge/src/checker.ts); null or absent: exactly. */
  checker?: Checker | null
}

export interface CaseResult {
  caseId?: string
  verdict: Verdict
  /** A checker program's share of the points (verdict PC), and what it said (for staff). */
  fraction?: number
  checkerMessage?: string
  stdout: string
  stderr: string
  wallMs: number
  maxRssKb: number | null
  exitCode: number | null
}

export interface JudgeResult {
  verdict: Verdict
  compileOutput: string | null
  cases: CaseResult[]
}

/** How the program ended, when that decides the verdict; null when it finished cleanly. */
function ending(result: ExecResult, memoryLimitMb: number): Verdict | null {
  if (result.sandboxDied === "oom") return "MLE"
  if (result.sandboxDied === "crash") return "RE"
  if (result.outputLimitExceeded) return "OLE"
  if (result.timedOut) return "TLE"
  const overMemory =
    result.maxRssKb !== null && result.maxRssKb > memoryLimitMb * 1024
  if (result.exitCode === OOM_EXIT_CODE || overMemory) return "MLE"
  if (result.exitCode !== 0) return "RE"
  return null
}

const CHECKER_DIED =
  "The checker stopped its sandbox (too much memory or too many processes)."

/**
 * The teacher's checker program (packages/judge/src/checker.ts), in a sandbox of its own: the
 * only place a test's expected output enters a sandbox, and never the student's. Built once per
 * submission; each test gets input.txt, output.txt and answer.txt, fresh.
 */
class CheckerProgram {
  private dead = false
  private constructor(
    private readonly sandbox: Sandbox,
    private readonly language: LanguageDefinition
  ) {}

  /** The checker built and ready, or why it isn't (a failed build is the problem's, not the student's). */
  static async start(
    backend: SandboxBackend,
    program: NonNullable<Checker["program"]>
  ): Promise<
    { checker: CheckerProgram } | { failed: string; sandbox: Sandbox }
  > {
    const language: LanguageDefinition = LANGUAGES[program.language]
    const sandbox = await backend.create(language.image, {
      memoryMb: CHECKER_MEMORY_MB,
      cpus: 1,
      pids: 64,
      workspaceMb: 128,
    })
    await sandbox.upload([
      { path: language.defaultEntry, content: program.code },
    ])
    if (language.build) {
      const built = await sandbox.build(language.build(language.defaultEntry), {
        timeLimitMs: BUILD_TIME_LIMIT_MS,
        maxOutputBytes: LIMITS.maxOutputBytes,
      })
      if (built.exitCode !== 0)
        return {
          failed: `The checker doesn't compile: ${(built.stdout + built.stderr).slice(0, 400)}`,
          sandbox,
        }
      await sandbox.freeze()
    }
    return { checker: new CheckerProgram(sandbox, language) }
  }

  async check(input: string, output: string, answer: string) {
    if (this.dead)
      return { verdict: "SE" as const, fraction: 0, message: CHECKER_DIED }
    await this.sandbox.upload([
      { path: "input.txt", content: input },
      { path: "output.txt", content: output },
      { path: "answer.txt", content: answer },
    ])
    const run = await this.sandbox.run(
      this.language.run(this.language.defaultEntry),
      { timeLimitMs: CHECKER_TIME_MS, maxOutputBytes: 64 * 1024 }
    )
    if (run.sandboxDied) {
      this.dead = true
      return { verdict: "SE" as const, fraction: 0, message: CHECKER_DIED }
    }
    return readCheckerResult(run)
  }

  destroy() {
    return this.sandbox.destroy()
  }
}

export async function judge(
  backend: SandboxBackend,
  request: JudgeRequest
): Promise<JudgeResult> {
  const language: LanguageDefinition = LANGUAGES[request.language]
  const sandbox = await backend.create(language.image, {
    memoryMb: request.memoryLimitMb,
    cpus: 1,
    pids: 256,
    workspaceMb: 64,
  })

  let checker: CheckerProgram | null = null
  let checkerFailed: string | null = null
  try {
    await sandbox.upload(request.files)

    let compileOutput: string | null = null
    if (language.build) {
      const built = await sandbox.build(language.build(request.entry), {
        timeLimitMs: BUILD_TIME_LIMIT_MS,
        maxOutputBytes: LIMITS.maxOutputBytes,
      })
      compileOutput = (built.stdout + built.stderr).slice(
        0,
        OUTPUT_PREVIEW_BYTES
      )
      if (built.exitCode !== 0) {
        return { verdict: "CE", compileOutput, cases: [] }
      }
      await sandbox.freeze()
    }

    // A checker program, when the problem has one and anything is to be checked.
    const program = request.checker?.program
    if (program && request.cases.some((c) => c.expected !== null)) {
      const started = await CheckerProgram.start(backend, program)
      if ("checker" in started) checker = started.checker
      else {
        checkerFailed = started.failed
        await started.sandbox.destroy()
      }
    }

    const cases: CaseResult[] = []
    const deadline = Date.now() + JOB_DEADLINE_MS
    const groups = request.cases.map((c) => ({ group: c.group ?? null }))
    for (const [index, testCase] of request.cases.entries()) {
      // A group that has already failed can't score: don't spend the time running the rest.
      if (
        skipsCase(
          groups,
          index,
          cases.map((c) => c.verdict)
        )
      ) {
        cases.push({
          caseId: testCase.id,
          verdict: "SK",
          stdout: "",
          stderr: "",
          wallMs: 0,
          maxRssKb: null,
          exitCode: null,
        })
        continue
      }
      if (Date.now() > deadline) {
        cases.push({
          caseId: testCase.id,
          verdict: "TLE",
          stdout: "",
          stderr: "The submission as a whole took too long.",
          wallMs: 0,
          maxRssKb: null,
          exitCode: null,
        })
        break
      }
      const result = await sandbox.run(language.run(request.entry), {
        stdin: testCase.input,
        timeLimitMs: request.timeLimitMs,
        maxOutputBytes: LIMITS.maxOutputBytes,
      })
      let verdict = ending(result, request.memoryLimitMb)
      let checked: { fraction?: number; checkerMessage?: string } = {}
      if (!verdict) {
        if (testCase.expected === null) verdict = "OK"
        else if (program) {
          if (checkerFailed || !checker) {
            verdict = "SE"
            checked = { checkerMessage: checkerFailed ?? undefined }
          } else {
            const r = await checker.check(
              testCase.input,
              result.stdout,
              testCase.expected
            )
            verdict = r.verdict
            checked = { fraction: r.fraction, checkerMessage: r.message }
          }
        } else
          verdict = compareOutputs(
            result.stdout,
            testCase.expected,
            request.checker ?? null
          )
            ? "AC"
            : "WA"
      }
      cases.push({
        caseId: testCase.id,
        verdict,
        ...checked,
        stdout: result.stdout.slice(0, OUTPUT_PREVIEW_BYTES),
        stderr: result.sandboxDied
          ? SANDBOX_DIED_MESSAGE
          : result.stderr.slice(0, OUTPUT_PREVIEW_BYTES),
        wallMs: result.wallMs,
        maxRssKb: result.maxRssKb,
        exitCode: result.exitCode,
      })
      // Nothing can run in a dead sandbox, so the remaining cases are unjudged.
      if (result.sandboxDied) break
    }
    return { verdict: overallVerdict(cases), compileOutput, cases }
  } finally {
    await Promise.all([sandbox.destroy(), checker?.destroy()])
  }
}
