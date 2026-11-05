"use client"

import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"

/** A stopwatch for timing yourself on a problem. Resets when you move to another problem. */
export function Stopwatch() {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running) return
    const started = Date.now() - elapsed * 1000
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      500
    )
    return () => clearInterval(timer)
    // elapsed is only read when (re)starting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0")
  const seconds = String(elapsed % 60).padStart(2, "0")
  return (
    <span className="inline-flex items-center">
      <Button
        variant="ghost"
        size="sm"
        title={running ? "Pause the stopwatch" : "Start the stopwatch"}
        aria-label={running ? "Pause the stopwatch" : "Start the stopwatch"}
        onClick={() => setRunning(!running)}
      >
        {elapsed || running ? (
          <span data-testid="stopwatch" className="font-mono tabular-nums">
            {minutes}:{seconds}
          </span>
        ) : (
          "⏱"
        )}
      </Button>
      {elapsed > 0 && !running && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Reset the stopwatch"
          onClick={() => setElapsed(0)}
        >
          ↺
        </Button>
      )}
    </span>
  )
}
