import {
  LANGUAGES,
  LIMITS,
  outputsMatch,
  overallVerdict,
  type LanguageDefinition,
  type LanguageId,
  type SourceFile,
  type Verdict,
} from "@workspace/judge"

import type { ExecResult, SandboxBackend } from "./sandbox/types.ts"

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
}

export interface JudgeRequest {
  language: LanguageId
  files: SourceFile[]
  entry: string
  cases: JudgeCase[]
  timeLimitMs: number
  memoryLimitMb: number
}

export interface CaseResult {
  caseId?: string
  verdict: Verdict
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

function classify(
  result: ExecResult,
  expected: string | null,
  memoryLimitMb: number
): Verdict {
  if (result.sandboxDied === "oom") return "MLE"
  if (result.sandboxDied === "crash") return "RE"
  if (result.outputLimitExceeded) return "OLE"
  if (result.timedOut) return "TLE"
  const overMemory =
    result.maxRssKb !== null && result.maxRssKb > memoryLimitMb * 1024
  if (result.exitCode === OOM_EXIT_CODE || overMemory) return "MLE"
  if (result.exitCode !== 0) return "RE"
  if (expected === null) return "OK"
  return outputsMatch(result.stdout, expected) ? "AC" : "WA"
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

    const cases: CaseResult[] = []
    const deadline = Date.now() + JOB_DEADLINE_MS
    for (const testCase of request.cases) {
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
      cases.push({
        caseId: testCase.id,
        verdict: classify(result, testCase.expected, request.memoryLimitMb),
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
    await sandbox.destroy()
  }
}
