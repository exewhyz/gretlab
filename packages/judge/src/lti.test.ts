import assert from "node:assert/strict"
import { test } from "node:test"

import { checkLaunch, isInstructor, LTI, scoresUrl } from "./lti.ts"

const now = 1_800_000_000
const expect = { issuer: "https://lms.example", clientId: "tool-1", deploymentIds: ["d1"], nonce: "n1", now }
const good = {
  iss: "https://lms.example",
  aud: "tool-1",
  sub: "u-42",
  exp: now + 300,
  iat: now - 5,
  nonce: "n1",
  [LTI.version]: "1.3.0",
  [LTI.deploymentId]: "d1",
  [LTI.messageType]: "LtiResourceLinkRequest",
  [LTI.resourceLink]: { id: "rl-1" },
}

test("a proper launch", () => {
  assert.deepEqual(checkLaunch(good, expect), { kind: "resource" })
  assert.deepEqual(checkLaunch({ ...good, aud: ["tool-1", "x"], azp: "tool-1" }, expect), { kind: "resource" })
})

test("each check refuses", () => {
  const bad = (change: Record<string, unknown>) => "error" in checkLaunch({ ...good, ...change }, expect)
  assert.ok(bad({ iss: "https://other" }))
  assert.ok(bad({ aud: "tool-2" }))
  assert.ok(bad({ aud: ["tool-1", "x"], azp: "x" }))
  assert.ok(bad({ exp: now - 120 }))
  assert.ok(bad({ iat: now + 120 }))
  assert.ok(bad({ nonce: "n2" }))
  assert.ok(bad({ sub: "" }))
  assert.ok(bad({ [LTI.version]: "1.1" }))
  assert.ok(bad({ [LTI.deploymentId]: "d2" }))
  assert.ok(bad({ [LTI.messageType]: "LtiSubmissionReviewRequest" }))
  assert.ok(bad({ [LTI.resourceLink]: undefined }))
})

test("clock skew of a minute is fine", () => {
  assert.ok("kind" in checkLaunch({ ...good, exp: now - 30, iat: now + 30 }, expect))
})

test("deep linking needs a return address", () => {
  const dl = { ...good, [LTI.messageType]: "LtiDeepLinkingRequest" }
  assert.ok("error" in checkLaunch(dl, expect))
  assert.deepEqual(checkLaunch({ ...dl, [LTI.deepLinking]: { deep_link_return_url: "https://lms/x" } }, expect), { kind: "deep_link" })
})

test("instructors by LIS role", () => {
  assert.ok(isInstructor(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]))
  assert.ok(isInstructor(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor#TeachingAssistant"]))
  assert.ok(!isInstructor(["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]))
  assert.ok(!isInstructor(undefined))
})

test("scores go to the line item's /scores, query kept", () => {
  assert.equal(scoresUrl("https://lms.example/api/lineitems/7?type=1"), "https://lms.example/api/lineitems/7/scores?type=1")
  assert.equal(scoresUrl("https://lms.example/api/lineitems/7/"), "https://lms.example/api/lineitems/7/scores")
})
