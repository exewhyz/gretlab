import assert from "node:assert/strict"
import { test } from "node:test"

import { contestRatings, INITIAL_RATING, NEWCOMER_CONTESTS } from "./rating.ts"

const person = (id: string, rank: number, rating?: number, rated = 10) => ({
  id,
  rank,
  rating: rating ?? INITIAL_RATING,
  ratedContests: rated,
})

test("newcomers start at the initial rating; the winner goes up, the last goes down", () => {
  const out = contestRatings([
    person("a", 1, undefined, 0),
    person("b", 2, undefined, 0),
    person("c", 3, undefined, 0),
  ])
  const by = Object.fromEntries(out.map((r) => [r.id, r]))
  assert.equal(by.a!.before, INITIAL_RATING)
  assert.ok(by.a!.after > INITIAL_RATING)
  assert.equal(by.b!.after, INITIAL_RATING, "the middle of equals stays put")
  assert.ok(by.c!.after < INITIAL_RATING)
})

test("among equals, changes add up to nothing", () => {
  const out = contestRatings([
    person("a", 1),
    person("b", 2),
    person("c", 3),
    person("d", 4),
  ])
  assert.equal(
    out.reduce((sum, r) => sum + (r.after - r.before), 0),
    0
  )
})

test("beating someone rated far higher gains more than beating someone lower", () => {
  const upset = contestRatings([
    person("low", 1, 1200),
    person("high", 2, 2000),
  ])
  const expected = contestRatings([
    person("high", 1, 2000),
    person("low", 2, 1200),
  ])
  const gain = (list: ReturnType<typeof contestRatings>, id: string) =>
    list.find((r) => r.id === id)!.after - list.find((r) => r.id === id)!.before
  assert.ok(gain(upset, "low") > gain(expected, "high"))
  assert.ok(gain(upset, "low") > 20)
  assert.ok(gain(expected, "high") < 5)
})

test("a tie is half a win: two equals sharing a rank don't move", () => {
  const out = contestRatings([person("a", 1), person("b", 1)])
  assert.deepEqual(
    out.map((r) => r.after),
    [INITIAL_RATING, INITIAL_RATING]
  )
})

test("newcomers move twice as fast for their first contests", () => {
  const settled = contestRatings([person("a", 1), person("b", 2)])
  const fresh = contestRatings([
    person("a", 1, undefined, NEWCOMER_CONTESTS - 1),
    person("b", 2),
  ])
  const gain = (list: ReturnType<typeof contestRatings>) =>
    list.find((r) => r.id === "a")!.after - INITIAL_RATING
  assert.equal(gain(fresh), gain(settled) * 2)
})

test("one contestant alone, or nobody, changes nothing", () => {
  assert.deepEqual(contestRatings([]), [])
  const [only] = contestRatings([person("a", 1, 1600)])
  assert.equal(only!.after, 1600)
})

test("ratings stay whole numbers and never drop below zero", () => {
  const out = contestRatings([person("a", 1, 3000), person("b", 2, 5)])
  assert.ok(out.every((r) => Number.isInteger(r.after) && r.after >= 0))
})
