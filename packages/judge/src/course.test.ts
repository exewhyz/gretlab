import assert from "node:assert/strict"
import { test } from "node:test"

import {
  addDays,
  attemptState,
  courseGrade,
  duringAttempt,
  gradeShares,
  labPoints,
  releaseModules,
} from "./course.ts"

const rule = (
  openAfterDays: number | null,
  afterPrevious = false,
  total = 2,
  done = 0
) => ({
  openAfterDays,
  afterPrevious,
  total,
  done,
})

test("days count from the class's start, across months", () => {
  assert.equal(addDays("2026-01-30", 3), "2026-02-02")
  assert.equal(addDays("2026-11-10", 0), "2026-11-10")
})

test("a module opens on its day", () => {
  const [a, b] = releaseModules(
    [rule(null), rule(7)],
    "2026-11-01",
    "2026-11-05"
  )
  assert.equal(a!.open, true)
  assert.equal(b!.open, false)
  assert.equal(b!.waiting, "date")
  assert.equal(b!.opensOn, "2026-11-08")
  assert.equal(
    releaseModules([rule(null), rule(7)], "2026-11-01", "2026-11-08")[1]!.open,
    true
  )
})

test("nothing opens before the class starts", () => {
  assert.equal(
    releaseModules([rule(null)], "2026-12-01", "2026-11-30")[0]!.open,
    false
  )
})

test("after the previous one: waits until it's finished", () => {
  const waiting = releaseModules(
    [rule(null, false, 2, 1), rule(null, true)],
    "2026-11-01",
    "2026-11-02"
  )
  assert.equal(waiting[1]!.open, false)
  assert.equal(waiting[1]!.waiting, "previous")
  const done = releaseModules(
    [rule(null, false, 2, 2), rule(null, true)],
    "2026-11-01",
    "2026-11-02"
  )
  assert.equal(done[1]!.open, true)
})

test("a chain stays closed behind a closed module, even an empty one", () => {
  const r = releaseModules(
    [rule(null, false, 1, 0), rule(null, true, 0, 0), rule(null, true, 1, 0)],
    "2026-11-01",
    "2026-11-02"
  )
  assert.deepEqual(
    r.map((m) => m.open),
    [true, false, false]
  )
})

test("an empty module that's open counts as finished", () => {
  const r = releaseModules(
    [rule(null, false, 0, 0), rule(null, true)],
    "2026-11-01",
    "2026-11-01"
  )
  assert.equal(r[1]!.open, true)
})

test("both rules: the day and the previous module", () => {
  const r = releaseModules(
    [rule(null, false, 1, 1), rule(14, true)],
    "2026-11-01",
    "2026-11-05"
  )
  assert.equal(r[1]!.waiting, "date")
})

const at = (s: string) => new Date(`2026-11-17T${s}Z`)

test("an attempt runs until finished or out of time; untimed runs until finished", () => {
  const timed = {
    startedAt: at("10:00:00"),
    endsAt: at("10:30:00"),
    finishedAt: null,
  }
  assert.equal(attemptState(null, at("10:00:00")), "not_started")
  assert.equal(attemptState(timed, at("10:29:59")), "running")
  assert.equal(attemptState(timed, at("10:30:00")), "finished")
  assert.equal(
    attemptState({ ...timed, finishedAt: at("10:10:00") }, at("10:11:00")),
    "finished"
  )
  const untimed = { startedAt: at("10:00:00"), endsAt: null, finishedAt: null }
  assert.equal(attemptState(untimed, at("23:00:00")), "running")
  assert.equal(
    attemptState({ ...untimed, finishedAt: at("11:00:00") }, at("11:00:01")),
    "finished"
  )
})

test("work counts from the start until the close, with a few seconds' grace", () => {
  const a = {
    startedAt: at("10:00:00"),
    endsAt: at("10:30:00"),
    finishedAt: null,
  }
  assert.equal(duringAttempt(a, at("09:59:59")), false)
  assert.equal(duringAttempt(a, at("10:30:09")), true)
  assert.equal(duringAttempt(a, at("10:30:11")), false)
  assert.equal(duringAttempt(null, at("10:10:00")), false)
  // Finishing early closes it then.
  assert.equal(
    duringAttempt({ ...a, finishedAt: at("10:05:00") }, at("10:06:00")),
    false
  )
  // No grace after pressing Finish.
  assert.equal(
    duringAttempt({ ...a, finishedAt: at("10:05:00") }, at("10:05:05")),
    false
  )
  assert.equal(
    duringAttempt({ ...a, finishedAt: at("10:05:00") }, at("10:05:00")),
    true
  )
})

test("a lab problem scores the best submission during the attempt", () => {
  const a = {
    startedAt: at("10:00:00"),
    endsAt: at("10:30:00"),
    finishedAt: null,
  }
  const sub = (
    t: string,
    verdict: string,
    score: number | null = null,
    maxScore: number | null = null
  ) => ({
    createdAt: at(t),
    verdict,
    score,
    maxScore,
  })
  // Solved before starting: doesn't count.
  assert.equal(labPoints(100, [sub("09:00:00", "AC")], a), 0)
  assert.equal(
    labPoints(100, [sub("10:05:00", "WA"), sub("10:10:00", "AC")], a),
    100
  )
  assert.equal(
    labPoints(
      50,
      [sub("10:05:00", "WA", 30, 100), sub("10:06:00", "WA", 60, 100)],
      a
    ),
    30
  )
  assert.equal(labPoints(100, [sub("11:00:00", "AC")], a), 0)
})

test("the course grade weighs each checkpoint's share", () => {
  const g = courseGrade([
    { weight: 1, earned: 8, max: 10, final: true },
    { weight: 1, earned: 50, max: 100, final: true },
    { weight: 2, earned: 0, max: 100, final: false },
  ])
  // (0.8 + 0.5 + 0) / 4
  assert.equal(g.grade, 32.5)
  // Only the two final ones: (0.8 + 0.5) / 2
  assert.equal(g.sofar, 65)
  assert.equal(g.counted, 2)
  assert.equal(g.of, 3)
  assert.deepEqual(courseGrade([]), {
    grade: null,
    sofar: null,
    counted: 0,
    of: 0,
  })
  // Empty checkpoints (no points) don't count.
  assert.equal(
    courseGrade([
      { weight: 1, earned: 0, max: 0, final: true },
      { weight: 1, earned: 5, max: 5, final: true },
    ]).grade,
    100
  )
  assert.deepEqual(gradeShares([1, 1, 2]), [25, 25, 50])
})
