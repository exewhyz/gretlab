import assert from "node:assert/strict"
import { test } from "node:test"

import {
  afterFailure,
  OUTBOX_RETRY_SECONDS,
  permanentHttp,
  permanentSmtp,
} from "./outbox.ts"

test("temporary failures back off: 1 min, 5 min, 30 min, 2 h, 6 h", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => afterFailure(n, false)),
    OUTBOX_RETRY_SECONDS.map((inSeconds) => ({ retry: true, inSeconds }))
  )
})

test("after the last wait it gives up", () => {
  assert.deepEqual(afterFailure(6, false), { retry: false, reason: "attempts" })
  assert.deepEqual(afterFailure(9, false), { retry: false, reason: "attempts" })
})

test("a permanent failure stops at once", () => {
  assert.deepEqual(afterFailure(1, true), { retry: false, reason: "permanent" })
})

test("HTTP: rate limits, timeouts, key problems, server errors, no answer: temporary", () => {
  for (const status of [429, 408, 401, 403, 500, 502, 503, null, undefined]) {
    assert.equal(permanentHttp(status), false, String(status))
  }
  for (const status of [400, 404, 422]) {
    assert.equal(permanentHttp(status), true, String(status))
  }
})

test("SMTP: 4xx is temporary, 5xx permanent", () => {
  assert.equal(permanentSmtp(421), false)
  assert.equal(permanentSmtp(451), false)
  assert.equal(permanentSmtp(null), false)
  assert.equal(permanentSmtp(550), true)
  assert.equal(permanentSmtp(554), true)
})
