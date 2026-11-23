import assert from "node:assert/strict"
import { test } from "node:test"

import { ALERT_TIMING, planAlerts, type OpenAlert } from "./alerts.ts"

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 23, 9, minutes))
const queue = (level: "critical" | "warning" = "critical") => ({
  key: "queue_waiting",
  level,
  text: "Submissions have waited 4 minutes for a judge (3 waiting).",
})
const open = (overrides: Partial<OpenAlert> = {}): OpenAlert => ({
  key: "queue_waiting",
  level: "critical",
  text: "old text",
  firstSeenAt: at(0),
  lastSeenAt: at(0),
  notifiedLevel: "critical",
  ...overrides,
})

test("the timing: warnings wait 5 minutes, and so does the all clear", () => {
  assert.equal(ALERT_TIMING.warnAfterMs, 5 * 60_000)
  assert.equal(ALERT_TIMING.clearAfterMs, 5 * 60_000)
})

test("nothing wrong, nothing open: nothing to do", () => {
  assert.deepEqual(planAlerts([], [], at(0)), {
    start: [],
    seen: [],
    notify: [],
    clear: [],
  })
})

test("a critical problem is opened and emailed at once", () => {
  const plan = planAlerts([], [queue()], at(0))
  assert.deepEqual(plan.start, [queue()])
  assert.deepEqual(plan.notify, [{ ...queue(), kind: "started" }])
})

test("a warning is opened but emailed only once it has lasted 5 minutes", () => {
  const first = planAlerts([], [queue("warning")], at(0))
  assert.equal(first.start.length, 1)
  assert.deepEqual(first.notify, [])
  const still = open({ level: "warning", notifiedLevel: null })
  assert.deepEqual(planAlerts([still], [queue("warning")], at(4)).notify, [])
  assert.deepEqual(planAlerts([still], [queue("warning")], at(5)).notify, [
    { ...queue("warning"), kind: "started" },
  ])
})

test("an emailed problem isn't emailed again while it lasts", () => {
  const plan = planAlerts([open()], [queue()], at(30))
  assert.deepEqual(plan.notify, [])
  assert.deepEqual(plan.seen, [queue()], "its text and level are kept current")
  assert.deepEqual(plan.start, [])
})

test("a warning that turns critical is emailed again", () => {
  const was = open({ level: "warning", notifiedLevel: "warning" })
  assert.deepEqual(planAlerts([was], [queue()], at(10)).notify, [
    { ...queue(), kind: "worse" },
  ])
  // Critical easing to a warning isn't news.
  const critical = open()
  assert.deepEqual(
    planAlerts([critical], [queue("warning")], at(10)).notify,
    []
  )
})

test("a problem gone for 5 minutes clears, with an all clear if it was emailed", () => {
  const emailed = open({ lastSeenAt: at(10) })
  assert.deepEqual(planAlerts([emailed], [], at(14)).clear, [], "not yet")
  assert.deepEqual(planAlerts([emailed], [], at(15)).clear, [
    { key: "queue_waiting", level: "critical", text: "old text", notify: true },
  ])
  const quiet = open({
    level: "warning",
    notifiedLevel: null,
    lastSeenAt: at(1),
  })
  assert.deepEqual(planAlerts([quiet], [], at(9)).clear, [
    { key: "queue_waiting", level: "warning", text: "old text", notify: false },
  ])
})

test("notes (info) are never alerts", () => {
  const plan = planAlerts(
    [],
    [
      {
        key: "judges_outdated",
        level: "info",
        text: "1 judge runs older code.",
      },
    ],
    at(0)
  )
  assert.deepEqual(plan, { start: [], seen: [], notify: [], clear: [] })
})

test("each problem is its own alert", () => {
  const email = {
    key: "email_failed",
    level: "warning" as const,
    text: "3 emails failed.",
  }
  const plan = planAlerts([open()], [queue(), email], at(20))
  assert.deepEqual(plan.start, [email])
  assert.deepEqual(plan.seen, [queue()])
})
