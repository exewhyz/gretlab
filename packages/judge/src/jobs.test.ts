import assert from "node:assert/strict"
import { test } from "node:test"

import {
  JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS,
  jobAfterFailure,
  jobStuck,
  JOB_KEEP,
} from "./jobs.ts"

test("a step holds its job for a minute; five tries in all", () => {
  assert.equal(JOB_LEASE_MS, 60_000)
  assert.equal(JOB_MAX_ATTEMPTS, 5)
})

test("a failed step is tried again later, waiting longer each time", () => {
  assert.deepEqual(jobAfterFailure(1), { status: "queued", retryInMs: 30_000 })
  assert.deepEqual(jobAfterFailure(2), { status: "queued", retryInMs: 120_000 })
  assert.deepEqual(jobAfterFailure(3), { status: "queued", retryInMs: 600_000 })
  assert.deepEqual(jobAfterFailure(4), { status: "queued", retryInMs: 1_800_000 })
})

test("after the fifth failure the job has failed", () => {
  assert.deepEqual(jobAfterFailure(5), { status: "failed", retryInMs: null })
  assert.deepEqual(jobAfterFailure(9), { status: "failed", retryInMs: null })
})

test("a job waiting over 10 minutes is stuck (nothing is running jobs)", () => {
  const now = new Date("2026-11-23T10:00:00Z")
  assert.equal(jobStuck(new Date("2026-11-23T09:51:00Z"), now), false)
  assert.equal(jobStuck(new Date("2026-11-23T09:50:00Z"), now), true)
  assert.equal(jobStuck(null, now), false)
})

test("finished jobs are kept 30 days, their files a day", () => {
  assert.equal(JOB_KEEP.jobsDays, 30)
  assert.equal(JOB_KEEP.fileHours, 24)
})
