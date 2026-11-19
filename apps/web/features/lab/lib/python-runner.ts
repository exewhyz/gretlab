import type { SourceFile } from "@workspace/judge"

import { LAB_CONFIG } from "../config"
import type { RunResult } from "../types"

export type EngineStatus =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "failed"; message: string }

interface PendingRun {
  id: number
  resolve: (result: RunResult) => void
  timer: ReturnType<typeof setTimeout>
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; res: RunResult }

interface RunnerOptions {
  /** For messages: "Python", "JavaScript". */
  name: string
  /** The worker's address, built once the page has a base URL. */
  workerUrl: () => string
}

/**
 * Runs programs one at a time in a worker (public/py-worker.js, public/js-worker.js) under
 * a time limit. A stuck program can't be interrupted, so the worker is killed and restarted.
 */
export class BrowserRunner {
  status: EngineStatus = { state: "loading" }

  constructor(private readonly options: RunnerOptions) {}

  private worker: Worker | null = null
  private ready: Promise<boolean> = Promise.resolve(false)
  private resolveReady: (ok: boolean) => void = () => {}
  private pending: PendingRun | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.worker) this.start()
    return () => {
      this.listeners.delete(listener)
    }
  }

  getStatus = () => this.status

  run = (
    files: SourceFile[],
    entry: string,
    input: string
  ): Promise<RunResult> => {
    const job = () => this.execute(files, entry, input)
    const result = this.queue.then(job, job)
    this.queue = result.catch(() => {})
    return result
  }

  private setStatus(status: EngineStatus) {
    this.status = status
    this.listeners.forEach((listener) => listener())
  }

  private start() {
    this.setStatus({ state: "loading" })
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    const { name } = this.options
    try {
      this.worker = new Worker(this.options.workerUrl())
    } catch {
      this.fail(`This browser blocked the ${name} worker.`)
      return
    }
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.type === "ready") {
        this.setStatus({ state: "ready" })
        this.resolveReady(true)
      } else if (message.type === "failed") {
        this.fail(`${name} could not load: ${message.message}`)
      } else if (this.pending?.id === message.id) {
        const { resolve, timer } = this.pending
        this.pending = null
        clearTimeout(timer)
        resolve({
          ...message.res,
          failed: message.res.failed ?? Boolean(message.res.err),
        })
      }
    }
    this.worker.onerror = () => {
      this.fail(
        `${name} could not load. Check your internet connection and reload the page.`
      )
    }
  }

  private fail(message: string) {
    this.setStatus({ state: "failed", message })
    this.resolveReady(false)
  }

  private async execute(
    files: SourceFile[],
    entry: string,
    input: string
  ): Promise<RunResult> {
    const ok = await this.ready
    if (!ok || !this.worker) {
      return {
        out: "",
        err: `${this.options.name} is not available. Reload the page and try again.`,
        failed: true,
      }
    }
    return new Promise((resolve) => {
      const id = ++this.nextId
      const limit = LAB_CONFIG.timeLimitMs
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return
        this.pending = null
        this.worker?.terminate()
        this.start()
        resolve({
          out: "",
          err: `Time limit exceeded: the program ran for more than ${limit / 1000} seconds and was stopped.\nCheck for a loop that never ends, or for input() being called more times than needed.`,
          timeout: true,
          failed: true,
        })
      }, limit)
      this.pending = { id, resolve, timer }
      this.worker?.postMessage({ id, files, entry, input })
    })
  }
}

/** Pyodide in public/py-worker.js, loaded from LAB_CONFIG.pyodideUrl. */
export class PythonRunner extends BrowserRunner {
  constructor() {
    super({
      name: "Python",
      workerUrl: () => {
        const url = new URL("/py-worker.js", document.baseURI)
        url.searchParams.set(
          "u",
          new URL(LAB_CONFIG.pyodideUrl, document.baseURI).href
        )
        return url.href
      },
    })
  }
}

/** public/js-worker.js: JavaScript with the parts of Node programs use for input and output. */
export class JavaScriptRunner extends BrowserRunner {
  constructor() {
    super({
      name: "JavaScript",
      workerUrl: () => new URL("/js-worker.js", document.baseURI).href,
    })
  }
}
