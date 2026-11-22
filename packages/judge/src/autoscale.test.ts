import assert from "node:assert/strict"
import { test } from "node:test"

import { scaleDecision, type ScaleInput } from "./autoscale.ts"

/** A quiet moment with automatic scaling on and the defaults. */
const quiet = (over: Partial<ScaleInput> = {}): ScaleInput => ({
  on: true,
  minShared: 1,
  scaleUpSeconds: 30,
  idleMinutes: 20,
  studentsPerJudge: 60,
  maxRunning: 3,
  liveMachines: 0,
  onlineShared: 1,
  comingShared: 0,
  oldestSharedWaitSeconds: 0,
  examStudents: 0,
  idle: [],
  ...over,
})

test("off: nothing is ever started or ended", () => {
  assert.deepEqual(
    scaleDecision(
      quiet({ on: false, onlineShared: 0, oldestSharedWaitSeconds: 600 })
    ),
    { action: "none" }
  )
})

test("quiet, with the minimum online: nothing happens", () => {
  assert.deepEqual(scaleDecision(quiet()), { action: "none" })
})

test("below the minimum: a judge is started", () => {
  const d = scaleDecision(quiet({ onlineShared: 0 }))
  assert.equal(d.action, "start")
  assert.match(d.action === "start" ? d.reason : "", /minimum/)
})

test("work waiting longer than the limit: another judge is started", () => {
  const d = scaleDecision(quiet({ oldestSharedWaitSeconds: 45 }))
  assert.equal(d.action, "start")
  assert.match(d.action === "start" ? d.reason : "", /waited 45 s/)
})

test("work waiting, but not yet past the limit: wait", () => {
  assert.deepEqual(scaleDecision(quiet({ oldestSharedWaitSeconds: 29 })), {
    action: "none",
  })
})

test("one judge at a time: none started while another is still coming up", () => {
  assert.deepEqual(
    scaleDecision(quiet({ oldestSharedWaitSeconds: 300, comingShared: 1 })),
    { action: "none" }
  )
})

test("never past the running limit", () => {
  assert.deepEqual(
    scaleDecision(quiet({ oldestSharedWaitSeconds: 300, liveMachines: 3 })),
    { action: "none" }
  )
})

test("an exam soon: judges warmed up, one per 60 students sitting it", () => {
  // 150 students: 3 judges wanted, 1 online, so another starts.
  const d = scaleDecision(quiet({ examStudents: 150, maxRunning: 5 }))
  assert.equal(d.action, "start")
  assert.match(d.action === "start" ? d.reason : "", /exam/)
  // Enough online and coming up: nothing more.
  assert.deepEqual(
    scaleDecision(
      quiet({
        examStudents: 150,
        onlineShared: 2,
        comingShared: 1,
        maxRunning: 5,
      })
    ),
    { action: "none" }
  )
})

test("an exam's warm-up still keeps to the running limit", () => {
  assert.deepEqual(
    scaleDecision(quiet({ examStudents: 600, liveMachines: 3, maxRunning: 3 })),
    { action: "none" }
  )
})

test("a judge the scaler started, idle past the limit, is ended", () => {
  const d = scaleDecision(
    quiet({ onlineShared: 2, idle: [{ id: "m1", idleMinutes: 25 }] })
  )
  assert.deepEqual(d, {
    action: "drain",
    id: "m1",
    reason: "Idle for 25 minutes: ended by automatic scaling",
  })
})

test("never below the minimum, even when idle", () => {
  assert.deepEqual(
    scaleDecision(
      quiet({ onlineShared: 1, idle: [{ id: "m1", idleMinutes: 90 }] })
    ),
    { action: "none" }
  )
})

test("not ended while work is waiting, or while an exam needs it", () => {
  const idle = [{ id: "m1", idleMinutes: 90 }]
  assert.equal(
    scaleDecision(quiet({ onlineShared: 2, idle, oldestSharedWaitSeconds: 5 }))
      .action,
    "none"
  )
  assert.equal(
    scaleDecision(quiet({ onlineShared: 2, idle, examStudents: 120 })).action,
    "none"
  )
})

test("idle, but not yet for long enough: kept", () => {
  assert.deepEqual(
    scaleDecision(
      quiet({ onlineShared: 2, idle: [{ id: "m1", idleMinutes: 19 }] })
    ),
    { action: "none" }
  )
})

test("the longest idle is ended first, one at a time", () => {
  const d = scaleDecision(
    quiet({
      onlineShared: 3,
      idle: [
        { id: "m1", idleMinutes: 25 },
        { id: "m2", idleMinutes: 40 },
      ],
    })
  )
  assert.equal(d.action === "drain" ? d.id : null, "m2")
})
