import assert from "node:assert/strict"
import { test } from "node:test"

import {
  apiKeyMatches,
  apiKeyPrefix,
  eventMatches,
  isPrivateAddress,
  newApiKey,
  signWebhook,
  verifyWebhook,
  webhookRetryAt,
  webhookUrlProblem,
} from "./integrations.ts"

test("a new API key has a findable prefix and only its hash is kept", () => {
  const key = newApiKey()
  assert.match(key.token, /^glk_[a-z0-9]{10}_/)
  assert.equal(apiKeyPrefix(key.token), key.prefix)
  assert.ok(apiKeyMatches(key.token, key.hash))
  assert.ok(!apiKeyMatches(key.token + "x", key.hash))
  assert.ok(!key.hash.includes(key.token))
})

test("things that aren't keys have no prefix", () => {
  for (const t of ["", "Bearer x", "glk_short_x", "glk_ABCDEFGHIJ_" + "a".repeat(40)])
    assert.equal(apiKeyPrefix(t), null)
})

test("webhook patterns: everything, an area, or one event", () => {
  assert.ok(eventMatches(["*"], "leave.decide"))
  assert.ok(eventMatches(["leave.*"], "leave.decide"))
  assert.ok(!eventMatches(["leave.*"], "leaves.decide"))
  assert.ok(eventMatches(["member.add"], "member.add"))
  assert.ok(!eventMatches(["member.add"], "member.remove"))
  assert.ok(!eventMatches([], "member.add"))
})

test("a signature verifies with the secret, and not after five minutes or with another", () => {
  const at = new Date("2026-11-14T10:00:00Z")
  const header = signWebhook("whsec_a", '{"x":1}', at)
  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/)
  assert.ok(verifyWebhook("whsec_a", '{"x":1}', header, at))
  assert.ok(!verifyWebhook("whsec_b", '{"x":1}', header, at))
  assert.ok(!verifyWebhook("whsec_a", '{"x":2}', header, at))
  assert.ok(!verifyWebhook("whsec_a", '{"x":1}', header, new Date(at.getTime() + 301_000)))
})

test("retries back off from a minute to a day", () => {
  const from = new Date("2026-11-14T10:00:00Z")
  const after = (n: number) => (webhookRetryAt(n, from).getTime() - from.getTime()) / 60_000
  assert.deepEqual([1, 2, 3, 4, 7, 9].map(after), [1, 5, 15, 60, 1440, 1440])
})

test("webhooks go to public https addresses", () => {
  assert.equal(webhookUrlProblem("https://hooks.example.com/gretlab"), null)
  assert.match(webhookUrlProblem("http://hooks.example.com")!, /https/)
  assert.match(webhookUrlProblem("https://127.0.0.1/x")!, /public/)
  assert.match(webhookUrlProblem("https://10.0.0.5/x")!, /public/)
  assert.match(webhookUrlProblem("https://[::1]/x")!, /public/)
  assert.match(webhookUrlProblem("https://db.internal/x")!, /public/)
  assert.match(webhookUrlProblem("https://user:pw@example.com")!, /password/)
  assert.match(webhookUrlProblem("not a url")!, /web address/)
  assert.equal(webhookUrlProblem("http://127.0.0.1:3199/hook", true), null)
  assert.ok(isPrivateAddress("192.168.1.4") && isPrivateAddress("172.20.0.1") && !isPrivateAddress("8.8.8.8"))
})
