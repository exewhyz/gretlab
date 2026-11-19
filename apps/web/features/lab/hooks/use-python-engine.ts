"use client"

import { useSyncExternalStore } from "react"

import {
  JavaScriptRunner,
  PythonRunner,
  type BrowserRunner,
  type EngineStatus,
} from "../lib/python-runner"

// One engine per tab: Pyodide takes seconds to load, so page changes must not restart it.
const python = new PythonRunner()
const javascript = new JavaScriptRunner()
const SERVER_STATUS: EngineStatus = { state: "loading" }

const noSubscribe = () => () => {}

const runners: Record<string, BrowserRunner> = { python, javascript }

/** The browser engine for a language, or null for languages that only run on the server. */
export const browserRunnerFor = (language: string | undefined) =>
  (language && runners[language]) || null

/**
 * A language's browser engine. Pass enabled=false when code runs on the server, so Pyodide
 * is never downloaded.
 */
export function useBrowserEngine(language: string | undefined, enabled = true) {
  const runner = browserRunnerFor(language) ?? python
  const on = enabled && browserRunnerFor(language) !== null
  const status = useSyncExternalStore(
    on ? runner.subscribe : noSubscribe,
    runner.getStatus,
    () => SERVER_STATUS
  )
  return { status, isReady: on && status.state === "ready", run: runner.run }
}

/** Python's engine, for the status indicator. */
export function usePythonEngine(enabled = true) {
  return useBrowserEngine("python", enabled)
}
