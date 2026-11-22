import assert from "node:assert/strict"
import { test } from "node:test"

import { hourlyCost, judgeCosts, MACHINE_EXTRAS_HOURLY } from "./costs.ts"

const at = (iso: string) => new Date(iso)
const NOW = at("2026-11-22T12:00:00Z")

test("a machine's hour: its size's price, plus its address and disk", () => {
  assert.ok(
    Math.abs(MACHINE_EXTRAS_HOURLY - (0.005 + (30 * 0.096) / 730)) < 1e-9
  )
  assert.ok(
    Math.abs(hourlyCost("c7i-flex.large") - (0.11072 + MACHINE_EXTRAS_HOURLY)) <
      1e-9
  )
})

test("an unknown size costs as the largest allowed, so it's never understated", () => {
  assert.equal(hourlyCost("m7i.48xlarge"), hourlyCost("c7i.xlarge"))
})

test("a machine that ran ten hours this month costs ten hours", () => {
  const report = judgeCosts(
    [
      {
        size: "c7i-flex.large",
        pool: null,
        startedAt: at("2026-11-20T00:00:00Z"),
        endedAt: at("2026-11-20T10:00:00Z"),
      },
    ],
    NOW
  )
  assert.ok(Math.abs(report.soFar - 10 * hourlyCost("c7i-flex.large")) < 1e-9)
  assert.equal(report.runningHourly, 0)
})

test("only this month counts: a machine started last month counts from the 1st", () => {
  const report = judgeCosts(
    [
      {
        size: "c7i-flex.large",
        pool: null,
        startedAt: at("2026-10-31T00:00:00Z"),
        endedAt: at("2026-11-01T06:00:00Z"),
      },
    ],
    NOW
  )
  assert.ok(Math.abs(report.soFar - 6 * hourlyCost("c7i-flex.large")) < 1e-9)
})

test("a machine still running counts until now, and the forecast runs it to the month's end", () => {
  const report = judgeCosts(
    [
      {
        size: "c7i.large",
        pool: "gla",
        startedAt: at("2026-11-22T10:00:00Z"),
        endedAt: null,
      },
    ],
    NOW
  )
  const hourly = hourlyCost("c7i.large")
  assert.ok(Math.abs(report.soFar - 2 * hourly) < 1e-9)
  assert.ok(Math.abs(report.runningHourly - hourly) < 1e-9)
  // 22 Nov 12:00 to 1 Dec 00:00 is 8.5 days.
  assert.ok(Math.abs(report.forecast - (2 * hourly + 8.5 * 24 * hourly)) < 1e-6)
})

test("costs by pool: each organization's own judges, and the shared ones", () => {
  const report = judgeCosts(
    [
      {
        size: "c7i-flex.large",
        pool: "gla",
        startedAt: at("2026-11-22T10:00:00Z"),
        endedAt: at("2026-11-22T11:00:00Z"),
      },
      {
        size: "c7i-flex.large",
        pool: "gla",
        startedAt: at("2026-11-21T10:00:00Z"),
        endedAt: at("2026-11-21T12:00:00Z"),
      },
      {
        size: "c7i-flex.large",
        pool: null,
        startedAt: at("2026-11-21T10:00:00Z"),
        endedAt: at("2026-11-21T11:00:00Z"),
      },
    ],
    NOW
  )
  const hourly = hourlyCost("c7i-flex.large")
  assert.deepEqual(
    report.byPool.map((p) => [p.pool, p.hours]),
    [
      ["gla", 3],
      [null, 1],
    ]
  )
  assert.ok(Math.abs(report.byPool[0]!.cost - 3 * hourly) < 1e-9)
})

test("a machine never started costs nothing", () => {
  assert.equal(
    judgeCosts(
      [{ size: "c7i-flex.large", pool: null, startedAt: null, endedAt: null }],
      NOW
    ).soFar,
    0
  )
})
