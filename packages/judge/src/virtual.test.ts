import assert from "node:assert/strict"
import { test } from "node:test"

import type { LeaderboardConfig } from "./leaderboard.ts"
import { virtualBoard, virtualPhase, virtualRefusal } from "./virtual.ts"

const start = new Date("2026-11-01T10:00:00Z")
const minutes = (base: Date, m: number) => new Date(base.getTime() + m * 60_000)
const config: LeaderboardConfig = {
  scoring: "icpc",
  startsAt: start,
  endsAt: minutes(start, 120),
  penaltyMinutes: 20,
  freezeMinutes: 0,
  problemLabels: ["A", "B"],
}

test("who may start one: after the end, once, and not after taking part live", () => {
  const now = minutes(start, 200)
  const base = {
    contest: config,
    now,
    tookPartLive: false,
    alreadyTaken: false,
  }
  assert.equal(virtualRefusal(base), null)
  assert.equal(
    virtualRefusal({ ...base, now: minutes(start, 60) }),
    "contest_not_over"
  )
  assert.equal(
    virtualRefusal({ ...base, tookPartLive: true }),
    "took_part_live"
  )
  assert.equal(virtualRefusal({ ...base, alreadyTaken: true }), "already_taken")
})

test("an attempt runs for the contest's length, from when it started", () => {
  const began = new Date("2026-11-10T09:00:00Z")
  assert.deepEqual(virtualPhase(config, began, minutes(began, 30)), {
    running: true,
    elapsedMs: 30 * 60_000,
    endsAt: minutes(began, 120),
  })
  assert.equal(virtualPhase(config, began, minutes(began, 120)).running, false)
  assert.equal(
    virtualPhase(config, began, minutes(began, 500)).elapsedMs,
    120 * 60_000
  )
})

const real = [
  { id: "ana", user: "Ana" },
  { id: "ben", user: "Ben" },
]
const realSubs = [
  {
    userId: "ana",
    problemLabel: "A",
    verdict: "AC" as const,
    score: 100,
    createdAt: minutes(start, 10),
  },
  {
    userId: "ben",
    problemLabel: "A",
    verdict: "WA" as const,
    score: 0,
    createdAt: minutes(start, 20),
  },
  {
    userId: "ben",
    problemLabel: "A",
    verdict: "AC" as const,
    score: 100,
    createdAt: minutes(start, 25),
  },
  {
    userId: "ben",
    problemLabel: "B",
    verdict: "AC" as const,
    score: 100,
    createdAt: minutes(start, 90),
  },
]
const began = new Date("2026-11-10T09:00:00Z")
const taker = { id: "me", user: "Me" }

test("the board stands as the real one did at the same minute, with the taker's own work shifted onto it", () => {
  const rows = virtualBoard({
    config,
    participants: real,
    submissions: realSubs,
    taker,
    takerSubmissions: [
      {
        userId: "me",
        problemLabel: "A",
        verdict: "AC",
        score: 100,
        createdAt: minutes(began, 5),
      },
    ],
    startedAt: began,
    now: minutes(began, 30),
  })
  // At minute 30: Me solved A at 5, Ana at 10, Ben at 25 with one wrong try; Ben's B (at 90) hasn't happened.
  assert.deepEqual(
    rows.map((r) => [r.user, r.solved, r.penalty]),
    [
      ["Me", 1, 5],
      ["Ana", 1, 10],
      ["Ben", 1, 45],
    ]
  )
})

test("the taker's work after the moment isn't on it, nor real work after it", () => {
  const rows = virtualBoard({
    config,
    participants: real,
    submissions: realSubs,
    taker,
    takerSubmissions: [],
    startedAt: began,
    now: minutes(began, 15),
  })
  assert.deepEqual(
    rows.map((r) => [r.user, r.solved]),
    [
      ["Ana", 1],
      ["Ben", 0],
      ["Me", 0],
    ]
  )
})

test("once the attempt is over, the board is the final one with the taker in it", () => {
  const rows = virtualBoard({
    config,
    participants: real,
    submissions: realSubs,
    taker,
    takerSubmissions: [],
    startedAt: began,
    now: minutes(began, 999),
  })
  assert.equal(rows.find((r) => r.user === "Ben")?.solved, 2)
})

test("the freeze hides real results from the same point it did live, and lifts when the attempt ends", () => {
  const frozenConfig = { ...config, freezeMinutes: 60 }
  const at = (m: number) =>
    virtualBoard({
      config: frozenConfig,
      participants: real,
      submissions: realSubs,
      taker,
      takerSubmissions: [],
      startedAt: began,
      now: minutes(began, m),
    })
  const during = at(100).find((r) => r.user === "Ben")!
  assert.equal(during.solved, 1)
  assert.equal(during.problems[1]!.pending, 1)
  assert.equal(at(130).find((r) => r.user === "Ben")!.solved, 2)
})

test("someone who registered but never took part isn't counted twice when they take it", () => {
  const rows = virtualBoard({
    config,
    participants: [...real, { id: "me", user: "Me (registered)" }],
    submissions: realSubs,
    taker,
    takerSubmissions: [],
    startedAt: began,
    now: minutes(began, 999),
  })
  assert.equal(rows.length, 3)
  assert.ok(rows.some((r) => r.user === "Me"))
})
