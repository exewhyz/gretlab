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

/** Python's engine (the problem editor fills expected outputs with it). */
export function usePythonEngine(enabled = true) {
  return useBrowserEngine("python", enabled)
}

/**
 * The browser engine that's loaded, if any, without loading one: for the status indicator.
 * Null until a page asks for an engine.
 */
export function useLoadedEngine() {
  const read = () =>
    python.started ? python.status : javascript.started ? javascript.status : null
  const status = useSyncExternalStore(
    (listener) => {
      const a = python.watch(listener)
      const b = javascript.watch(listener)
      return () => {
        a()
        b()
      }
    },
    read,
    () => null
  )
  return {
    status,
    name: python.started ? "Python" : javascript.started ? "JavaScript" : null,
  }
}
