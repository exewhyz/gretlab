import assert from "node:assert/strict"
import { test } from "node:test"

import { seatsLeft, stopsProblem } from "./transport.ts"

const stop = (name: string, pickup = "", drop = "") => ({ name, pickup, drop })

test("stops need distinct names", () => {
  assert.equal(stopsProblem([stop("Gate"), stop(" ")]), "Stop 2 needs a name.")
  assert.equal(stopsProblem([stop("Gate"), stop("gate ")]), '"gate" is listed twice.')
})

test("times are optional, but must look like times", () => {
  assert.equal(stopsProblem([stop("A"), stop("B")]), null)
  assert.match(stopsProblem([stop("A", "7.30")]) ?? "", /times like/)
})

test("pick-ups run forward along the route, skipping blanks", () => {
  assert.equal(stopsProblem([stop("A", "07:00"), stop("B"), stop("C", "07:20")]), null)
  assert.match(stopsProblem([stop("A", "07:30"), stop("B", "07:10")]) ?? "", /Pick-up/)
})

test("drop-offs run back from the last stop", () => {
  assert.equal(stopsProblem([stop("A", "07:00", "15:40"), stop("B", "07:15", "15:20")]), null)
  assert.match(stopsProblem([stop("A", "07:00", "15:00"), stop("B", "07:15", "15:20")]) ?? "", /Drop-off/)
})

test("seats: a limit, never below zero, or none", () => {
  assert.equal(seatsLeft(40, 38), 2)
  assert.equal(seatsLeft(40, 45), 0)
  assert.equal(seatsLeft(null, 100), Number.POSITIVE_INFINITY)
})
