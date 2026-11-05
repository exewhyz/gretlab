"use client"

import { useSyncExternalStore } from "react"

import { PythonRunner, type EngineStatus } from "../lib/python-runner"

// One engine per tab: Pyodide takes seconds to load, so page changes must not restart it.
const runner = new PythonRunner()
const SERVER_STATUS: EngineStatus = { state: "loading" }

const noSubscribe = () => () => {}

/** Pass enabled=false when code runs on the server, so Pyodide is never downloaded. */
export function usePythonEngine(enabled = true) {
  const status = useSyncExternalStore(
    enabled ? runner.subscribe : noSubscribe,
    runner.getStatus,
    () => SERVER_STATUS
  )
  return { status, isReady: status.state === "ready", run: runner.run }
}
