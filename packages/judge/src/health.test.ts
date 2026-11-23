import assert from "node:assert/strict"
import { test } from "node:test"

import { healthProblems, type HealthInput } from "./health.ts"

const fine = (over: Partial<HealthInput> = {}): HealthInput => ({
  judgesOnline: 2,
  queued: 0,
  oldestQueuedSeconds: 0,
  systemErrorsLastHour: 0,
  emailQueued: 0,
  emailOldestSeconds: 0,
  emailFailedLastDay: 0,
  webhooksWaiting: 0,
  judgesOutOfDate: 0,
  jobsWaiting: 0,
  jobsOldestSeconds: 0,
  ...over,
})

test("all well: no problems", () => {
  assert.deepEqual(healthProblems(fine()), [])
})

test("no judge online with work waiting is critical", () => {
  const problems = healthProblems(fine({ judgesOnline: 0, queued: 4 }))
  assert.equal(problems[0]?.level, "critical")
  assert.match(problems[0]!.text, /No judge is online/)
})

test("no judge online with nothing waiting is only a warning", () => {
  assert.equal(healthProblems(fine({ judgesOnline: 0 }))[0]?.level, "warning")
})

test("work waiting: a warning past a minute, critical past three", () => {
  assert.equal(
    healthProblems(fine({ queued: 3, oldestQueuedSeconds: 59 })).length,
    0
  )
  assert.equal(
    healthProblems(fine({ queued: 3, oldestQueuedSeconds: 90 }))[0]?.level,
    "warning"
  )
  assert.equal(
    healthProblems(fine({ queued: 3, oldestQueuedSeconds: 200 }))[0]?.level,
    "critical"
  )
})

test("system errors in the last hour are a warning", () => {
  const [p] = healthProblems(fine({ systemErrorsLastHour: 2 }))
  assert.equal(p?.level, "warning")
  assert.match(p!.text, /2 submissions ended in a system error/)
})

test("email: failures and a backlog are warnings", () => {
  assert.match(
    healthProblems(fine({ emailFailedLastDay: 5 }))[0]!.text,
    /5 emails failed/
  )
  assert.match(
    healthProblems(fine({ emailQueued: 40, emailOldestSeconds: 1800 }))[0]!
      .text,
    /waited 30 minutes/
  )
  assert.equal(
    healthProblems(fine({ emailQueued: 40, emailOldestSeconds: 120 })).length,
    0
  )
})

test("a webhook backlog is a warning; out-of-date judges only a note", () => {
  assert.equal(
    healthProblems(fine({ webhooksWaiting: 150 }))[0]?.level,
    "warning"
  )
  assert.equal(healthProblems(fine({ judgesOutOfDate: 2 }))[0]?.level, "info")
})

test("the worst comes first", () => {
  const levels = healthProblems(
    fine({
      judgesOutOfDate: 1,
      emailFailedLastDay: 1,
      judgesOnline: 0,
      queued: 1,
    })
  ).map((p) => p.level)
  assert.deepEqual(levels, ["critical", "warning", "info"])
})

test("one is said as one", () => {
  const texts = healthProblems(
    fine({ systemErrorsLastHour: 1, emailFailedLastDay: 1, judgesOutOfDate: 1 })
  ).map((p) => p.text)
  assert.ok(
    texts.some((t) => t.startsWith("1 submission ended")),
    texts.join(" | ")
  )
  assert.ok(
    texts.some((t) => t.startsWith("1 email failed")),
    texts.join(" | ")
  )
  assert.ok(
    texts.some((t) => t.startsWith("1 judge runs older code")),
    texts.join(" | ")
  )
})

test("background jobs waiting 10 minutes: nothing is running them", () => {
  assert.deepEqual(
    healthProblems(fine({ jobsWaiting: 2, jobsOldestSeconds: 599 })),
    []
  )
  assert.deepEqual(
    healthProblems(fine({ jobsWaiting: 2, jobsOldestSeconds: 600 })),
    [
      {
        key: "jobs_waiting",
        level: "warning",
        text: "2 background jobs (exports and the like) are waiting; the oldest for 10 minutes. Is the cron running?",
      },
    ]
  )
})
