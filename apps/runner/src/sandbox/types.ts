import type { SourceFile } from "@workspace/judge"

export interface SandboxLimits {
  memoryMb: number
  /** Whole-container CPU share. */
  cpus: number
  pids: number
  /** Scratch space, which also counts against memory. */
  workspaceMb: number
}

export interface ExecOptions {
  stdin?: string
  /** Enforced inside the sandbox, with a host-side backstop just past it. */
  timeLimitMs: number
  maxOutputBytes: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  /** Null when the command had to be killed from outside. */
  exitCode: number | null
  wallMs: number
  /** As reported from inside the sandbox, so informational only. */
  maxRssKb: number | null
  timedOut: boolean
  outputLimitExceeded: boolean
  /** The program took the whole sandbox down; nothing further can run in it. */
  sandboxDied: "oom" | "crash" | null
}

/** One throwaway environment. Everything here is reachable only through these methods. */
export interface Sandbox {
  /** Stores files as a tar stream of regular files, out of the student's reach. */
  upload(files: SourceFile[]): Promise<void>
  /** Runs a build step in a fresh working directory. */
  build(command: string[], options: ExecOptions): Promise<ExecResult>
  /** Keeps the build's output: later runs start from the sources plus this. */
  freeze(): Promise<void>
  /** Kills leftovers, restores a fresh working directory, then runs. */
  run(command: string[], options: ExecOptions): Promise<ExecResult>
  destroy(): Promise<void>
}

export interface SandboxBackend {
  /** Throws if this backend can't provide the promised isolation. */
  verify(): Promise<void>
  create(image: string, limits: SandboxLimits): Promise<Sandbox>
  /** Removes old sandboxes left by crashes. Safe with other runners sharing the daemon. */
  sweepOrphans(): Promise<void>
}
