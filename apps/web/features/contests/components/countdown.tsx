"use client"

import { useEffect, useState } from "react"

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
  return days > 0 ? `${days}d ${clock}` : clock
}

/** Calls onFinish once when the time is reached, so a page can move to its next phase. */
export function Countdown({
  to,
  onFinish,
}: {
  to: string
  onFinish?: () => void
}) {
  const target = new Date(to).getTime()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= target) {
        clearInterval(timer)
        onFinish?.()
      }
    }, 1000)
    return () => clearInterval(timer)
    // onFinish is deliberately not a dependency: a new function shouldn't restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  // Rendered after mount, so server and browser clocks can't disagree during hydration.
  if (now === null) return <span className="tabular-nums">--:--:--</span>
  return (
    <span data-testid="countdown" className="tabular-nums">
      {formatRemaining(target - now)}
    </span>
  )
}
