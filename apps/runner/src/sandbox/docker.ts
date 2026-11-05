import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

import { isSafePath, type SourceFile } from "@workspace/judge"
import { pack } from "tar-stream"

import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxBackend,
  SandboxLimits,
} from "./types.ts"

const LABEL = "gretlab.sandbox=1"
const UID = "1000:1000"
const WORK = "/box/work"
const FROZEN = "/box/frozen"
const MAX_FILE_MB = 32
/** Longer than a job can last (see JOB_DEADLINE_MS in judge.ts). */
const ORPHAN_AGE_MS = 15 * 60_000

const RESET_FAILED = 99
/** How gVisor reports that its kernel died: internals, never to be shown to a student. */
const RUNTIME_FAILURE =
  /urpc method|waiting on PID|sandbox .* (is )?not running/i
const DEATH_CHECK_ATTEMPTS = 10
const DEATH_CHECK_DELAY_MS = 100
/**
 * Runs before every program, in the same call as it. Same uid, so `kill -1` reaches anything
 * an earlier run left behind and nothing else; scratch space is wiped too, so nothing carries
 * between tests. Its exit code is checked, so a failure can't be mistaken for the student's.
 */
const FRESH_START = `kill -9 -1 2>/dev/null; find ${WORK} /tmp /dev/shm -mindepth 1 -delete 2>/dev/null; cp -r ${FROZEN}/. ${WORK}/ || exit ${RESET_FAILED}; exec "$@"`

/** How long past the limit the host waits before treating the command as stuck. */
const BACKSTOP_GRACE_MS = 3000

interface Spawned {
  stdout: Buffer
  stderr: Buffer
  exitCode: number | null
  overflowed: boolean
  killedByBackstop: boolean
}

/** Always argument arrays, never a host shell: see the sandbox rules in AGENTS.md. */
function docker(
  args: string[],
  options: {
    stdin?: Buffer | string
    backstopMs?: number
    maxOutputBytes?: number
    onKill?: () => void
  } = {}
): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
    })
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
    const limit = options.maxOutputBytes ?? 1024 * 1024
    let total = 0
    let overflowed = false
    let killedByBackstop = false

    const collect = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      if (overflowed) return
      total += chunk.length
      chunks[stream].push(chunk)
      if (total > limit) {
        overflowed = true
        options.onKill?.()
        child.kill("SIGKILL")
      }
    }
    child.stdout.on("data", collect("stdout"))
    child.stderr.on("data", collect("stderr"))

    const timer = options.backstopMs
      ? setTimeout(() => {
          killedByBackstop = true
          options.onKill?.()
          child.kill("SIGKILL")
        }, options.backstopMs)
      : null

    child.on("error", reject)
    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(chunks.stdout),
        stderr: Buffer.concat(chunks.stderr),
        exitCode: killedByBackstop || overflowed ? null : exitCode,
        overflowed,
        killedByBackstop,
      })
    })
    // A program that exits without reading its input closes this pipe: not an error.
    child.stdin.on("error", () => {})
    child.stdin.end(options.stdin ?? "")
  })
}

function tarOf(files: SourceFile[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = pack()
    const chunks: Buffer[] = []
    archive.on("data", (chunk: unknown) => chunks.push(chunk as Buffer))
    archive.on("end", () => resolve(Buffer.concat(chunks)))
    archive.on("error", reject)
    for (const file of files) {
      // Re-checked here because this is the last step before untrusted names are used.
      if (!isSafePath(file.path)) {
        reject(new Error(`Unsafe path: ${file.path}`))
        return
      }
      // Regular files only: no symlink entry can ever be created from this.
      archive.entry(
        { name: file.path, type: "file", mode: 0o644 },
        file.content
      )
    }
    archive.finalize()
  })
}

class DockerSandbox implements Sandbox {
  constructor(private readonly id: string) {}

  private exec(user: string, command: string[], stdin?: Buffer) {
    return docker(
      ["exec", "-i", "--user", user, "--workdir", WORK, this.id, ...command],
      { stdin }
    )
  }

  /**
   * Into the root-owned area the student can't touch. Every program then starts from a fresh
   * copy of it, so one call per job rather than a separate upload, copy and reset.
   */
  async upload(files: SourceFile[]) {
    const tar = await tarOf(files)
    const result = await this.exec(
      "0:0",
      ["tar", "-x", "-f", "-", "-C", FROZEN],
      tar
    )
    if (result.exitCode !== 0) {
      throw new Error(
        `Upload failed: ${result.stderr.toString().slice(0, 500)}`
      )
    }
  }

  build(command: string[], options: ExecOptions) {
    return this.limited(command, options)
  }

  /** Keeps what the build produced, for the runs that follow. */
  async freeze() {
    const result = await this.exec("0:0", [
      "sh",
      "-c",
      `cp -r ${WORK}/. ${FROZEN}/ && chmod -R a+rX,go-w ${FROZEN}`,
    ])
    if (result.exitCode !== 0) {
      throw new Error(
        `Freeze failed: ${result.stderr.toString().slice(0, 500)}`
      )
    }
  }

  run(command: string[], options: ExecOptions) {
    return this.limited(command, options)
  }

  private async limited(
    command: string[],
    options: ExecOptions
  ): Promise<ExecResult> {
    const seconds = (options.timeLimitMs / 1000).toFixed(3)
    // The marker is random per run so ordinary program output can't be mistaken for it.
    const marker = `__gretlab_${randomBytes(12).toString("hex")}__`
    const started = performance.now()
    const result = await docker(
      [
        "exec",
        "-i",
        "--user",
        UID,
        "--workdir",
        WORK,
        this.id,
        "sh",
        "-c",
        FRESH_START,
        "sh",
        "/usr/bin/time",
        "-f",
        `\n${marker} %M`,
        "timeout",
        "-s",
        "KILL",
        seconds,
        ...command,
      ],
      {
        stdin: options.stdin,
        backstopMs: options.timeLimitMs + BACKSTOP_GRACE_MS,
        // The metrics line and any `docker exec` chatter must not count against the program.
        maxOutputBytes: options.maxOutputBytes + 256,
        onKill: () => void this.killAll(),
      }
    )
    const wallMs = Math.round(performance.now() - started)
    if (result.exitCode === RESET_FAILED) {
      throw new Error("Could not reset the sandbox between runs")
    }

    let stderr = result.stderr.toString()
    let maxRssKb: number | null = null
    const markerAt = stderr.lastIndexOf(`\n${marker} `)
    if (markerAt !== -1) {
      const kb = Number.parseInt(stderr.slice(markerAt + marker.length + 2), 10)
      maxRssKb = Number.isNaN(kb) ? null : kb
      stderr = stderr.slice(0, markerAt)
    }
    const finishedNormally = markerAt !== -1
    const sandboxDied =
      result.exitCode === 0 || finishedNormally
        ? null
        : await this.deathReason(RUNTIME_FAILURE.test(stderr))
    // GNU time adds this line when the child exits non-zero; it isn't the program's output.
    stderr = stderr.replace(
      /\n?Command (exited with non-zero status \d+|terminated by signal \d+)\s*$/,
      ""
    )

    return {
      stdout: result.stdout.toString(),
      // A dead sandbox's stderr is container runtime internals, not program output.
      stderr: sandboxDied ? "" : stderr,
      exitCode: result.exitCode,
      wallMs,
      maxRssKb,
      // `timeout -s KILL` exits 137. So does an out-of-memory kill, told apart by elapsed time.
      timedOut:
        result.killedByBackstop ||
        (result.exitCode === 137 && wallMs >= options.timeLimitMs),
      outputLimitExceeded: result.overflowed,
      sandboxDied,
    }
  }

  /**
   * `runtimeReported` is set when the container runtime itself said the sandbox failed. Docker
   * can take a moment to notice that, so its state is checked a few times before believing it.
   */
  private async deathReason(
    runtimeReported: boolean
  ): Promise<ExecResult["sandboxDied"]> {
    const attempts = runtimeReported ? DEATH_CHECK_ATTEMPTS : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      const state = await docker([
        "inspect",
        "--format",
        "{{.State.Running}} {{.State.OOMKilled}}",
        this.id,
      ])
      const [running, oomKilled] = state.stdout.toString().trim().split(" ")
      if (running !== "true") return oomKilled === "true" ? "oom" : "crash"
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, DEATH_CHECK_DELAY_MS)
        )
      }
    }
    return runtimeReported ? "crash" : null
  }

  private killAll() {
    return docker(["exec", "--user", UID, this.id, "sh", "-c", "kill -9 -1"], {
      backstopMs: 5000,
    }).catch(() => {})
  }

  async destroy() {
    await docker(["rm", "-f", "--volumes", this.id]).catch(() => {})
  }
}

export interface DockerBackendOptions {
  /** Labels its containers, for tracing and so runners sharing a daemon can be told apart. */
  runnerId: string
  runtime: string
  /** Development only, and refused in production. See AGENTS.md. */
  allowInsecureRunc: boolean
}

export class DockerBackend implements SandboxBackend {
  constructor(private readonly options: DockerBackendOptions) {}

  async verify() {
    const { runtime, allowInsecureRunc } = this.options
    if (runtime === "runsc") {
      const info = await docker(["info", "--format", "{{json .Runtimes}}"])
      if (!info.stdout.toString().includes('"runsc"')) {
        throw new Error(
          "gVisor (runsc) is not registered with Docker. Install it: https://gvisor.dev/docs/user_guide/install/"
        )
      }
      return
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Refusing to start: production requires SANDBOX_RUNTIME=runsc."
      )
    }
    if (!allowInsecureRunc) {
      throw new Error(
        `Refusing to use runtime "${runtime}" without gVisor. For local development only, set SANDBOX_ALLOW_INSECURE_RUNC=true.`
      )
    }
    console.warn(
      `[sandbox] WARNING: running untrusted code with "${runtime}", without gVisor. Development only.`
    )
  }

  async create(image: string, limits: SandboxLimits): Promise<Sandbox> {
    const { memoryMb, cpus, pids, workspaceMb } = limits
    const tmpfs = (path: string, owner: string, mode: string) =>
      `${path}:rw,exec,nosuid,nodev,size=${workspaceMb}m,${owner},mode=${mode}`
    const result = await docker(
      [
        "run",
        "--detach",
        "--runtime",
        this.options.runtime,
        "--label",
        LABEL,
        "--label",
        `gretlab.runner=${this.options.runnerId}`,
        // Isolation. Keep these in step with the rules in AGENTS.md.
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--ipc",
        "private",
        // Resources. Equal swap and memory means no swap at all.
        "--memory",
        `${memoryMb}m`,
        "--memory-swap",
        `${memoryMb}m`,
        "--cpus",
        String(cpus),
        "--pids-limit",
        String(pids),
        "--ulimit",
        `fsize=${MAX_FILE_MB * 1024 * 1024}`,
        "--ulimit",
        "nofile=256:256",
        "--ulimit",
        "core=0",
        // Writable scratch, in memory, gone with the container. No host path is ever mounted.
        "--tmpfs",
        // Readable by the capability-free root helper that freezes it.
        tmpfs(WORK, "uid=1000,gid=1000", "0755"),
        "--tmpfs",
        tmpfs(FROZEN, "uid=0,gid=0", "0755"),
        "--tmpfs",
        tmpfs("/tmp", "uid=1000,gid=1000", "0700"),
        // Long-running, does nothing, ignores everything the unprivileged user can send.
        image,
        "sleep",
        "infinity",
      ],
      { backstopMs: 30_000 }
    )
    const id = result.stdout.toString().trim()
    if (result.exitCode !== 0 || !id) {
      throw new Error(
        `Could not start sandbox: ${result.stderr.toString().slice(0, 500)}`
      )
    }
    return new DockerSandbox(id)
  }

  /** Old enough that no live runner can still be using it, whoever started it. */
  async sweepOrphans() {
    const list = await docker([
      "ps",
      "-a",
      "--filter",
      `label=${LABEL}`,
      "--format",
      "{{.ID}}\t{{.CreatedAt}}",
    ])
    const cutoff = Date.now() - ORPHAN_AGE_MS
    const ids = list.stdout
      .toString()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [id, created] = line.split("\t")
        const parsed = Date.parse((created ?? "").split(" +")[0] + "Z")
        return id && parsed < cutoff ? [id] : []
      })
    if (ids.length) await docker(["rm", "-f", "--volumes", ...ids])
  }

  /** Removes everything this daemon holds. For tests only. */
  async removeAll() {
    const list = await docker(["ps", "-aq", "--filter", `label=${LABEL}`])
    const ids = list.stdout.toString().split("\n").filter(Boolean)
    if (ids.length) await docker(["rm", "-f", "--volumes", ...ids])
  }
}

export function backendFromEnv(runnerId = "test"): DockerBackend {
  return new DockerBackend({
    runnerId,
    runtime: process.env.SANDBOX_RUNTIME ?? "runsc",
    allowInsecureRunc: process.env.SANDBOX_ALLOW_INSECURE_RUNC === "true",
  })
}
