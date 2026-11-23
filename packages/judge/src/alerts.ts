/*
 * When a problem on Dashboard › Monitoring becomes an email (alerts.test.ts). Pure: the web app
 * (features/monitoring/alerts.ts) gathers what's wrong now and what's already open, applies the
 * plan, and sends the emails.
 *
 * - Critical problems are emailed at once; warnings once they've lasted ALERT_TIMING.warnAfterMs,
 *   so a blip never wakes anyone.
 * - Each problem is emailed once while it lasts, and again only if it gets worse (a warning
 *   turning critical).
 * - A problem gone for ALERT_TIMING.clearAfterMs is cleared, with an all clear if it was emailed.
 * - Notes (level "info") are never alerts.
 */

export type AlertLevel = "critical" | "warning"

/** Something wrong now, under a key that stays the same while it lasts. */
export interface AlertSignal {
  key: string
  level: AlertLevel | "info"
  text: string
}

export interface OpenAlert {
  key: string
  level: AlertLevel
  text: string
  firstSeenAt: Date
  lastSeenAt: Date
  /** The level it was last emailed at; null while not emailed. */
  notifiedLevel: AlertLevel | null
}

type Current = { key: string; level: AlertLevel; text: string }

export interface AlertPlan {
  /** New problems to open. */
  start: Current[]
  /** Open problems still there: their level and text now. */
  seen: Current[]
  /** What to email now. */
  notify: (Current & { kind: "started" | "worse" })[]
  /** Open problems gone long enough; `notify` when the all clear is to be emailed. */
  clear: (Current & { notify: boolean })[]
}

export const ALERT_TIMING = {
  warnAfterMs: 5 * 60_000,
  clearAfterMs: 5 * 60_000,
} as const

export function planAlerts(
  open: OpenAlert[],
  signals: AlertSignal[],
  now: Date
): AlertPlan {
  const plan: AlertPlan = { start: [], seen: [], notify: [], clear: [] }
  const current = new Map<string, Current>()
  for (const s of signals) {
    if (s.level === "info" || current.has(s.key)) continue
    current.set(s.key, { key: s.key, level: s.level, text: s.text })
  }
  const byKey = new Map(open.map((a) => [a.key, a]))
  for (const signal of current.values()) {
    const existing = byKey.get(signal.key)
    if (existing) plan.seen.push(signal)
    else plan.start.push(signal)
    const since = existing?.firstSeenAt ?? now
    const lasted = now.getTime() - since.getTime() >= ALERT_TIMING.warnAfterMs
    const emailed = existing?.notifiedLevel ?? null
    if (emailed === null) {
      if (signal.level === "critical" || lasted) {
        plan.notify.push({ ...signal, kind: "started" })
      }
    } else if (emailed === "warning" && signal.level === "critical") {
      plan.notify.push({ ...signal, kind: "worse" })
    }
  }
  for (const alert of open) {
    if (current.has(alert.key)) continue
    if (now.getTime() - alert.lastSeenAt.getTime() < ALERT_TIMING.clearAfterMs)
      continue
    plan.clear.push({
      key: alert.key,
      level: alert.level,
      text: alert.text,
      notify: alert.notifiedLevel !== null,
    })
  }
  return plan
}
