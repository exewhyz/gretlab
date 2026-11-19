import assert from "node:assert/strict"
import { test } from "node:test"

import {
  browserGradingAllowed,
  isBrowserLanguage,
  perMinuteLimit,
  planExecution,
  readOrgExecution,
  workExecutionProblem,
  type ExecutionInput,
  type PlatformExecution,
} from "./execution.ts"

const all: PlatformExecution = { server: true, browser: true, browserGrading: true }
const serverOff: PlatformExecution = { ...all, server: false }

const plan = (over: Partial<ExecutionInput>) =>
  planExecution({
    platform: all,
    org: null,
    work: null,
    context: "practice",
    signedIn: true,
    ...over,
  })

test("with the server on, everything runs and is graded there", () => {
  assert.deepEqual(plan({}), { run: "server", submit: "server", browserOnly: false })
  assert.deepEqual(plan({ context: "contest", work: "server" }).submit, "server")
})

test("visitors run in their browser, never submit, never in contests", () => {
  assert.deepEqual(plan({ signedIn: false }), {
    run: "browser",
    submit: "none",
    browserOnly: true,
  })
  assert.equal(plan({ signedIn: false, context: "contest" }).run, "none")
  assert.equal(
    plan({ signedIn: false, platform: { ...all, browser: false } }).run,
    "none"
  )
})

test("server off: practice falls back to provisional browser grading", () => {
  assert.deepEqual(plan({ platform: serverOff }), {
    run: "browser",
    submit: "browser",
    browserOnly: true,
  })
  // Without the platform's grading switch, only runs.
  assert.deepEqual(plan({ platform: { ...serverOff, browserGrading: false } }), {
    run: "browser",
    submit: "none",
    browserOnly: true,
  })
})

test("server off: assignments run in the browser but don't submit; contests do neither", () => {
  assert.deepEqual(plan({ platform: serverOff, context: "assignment", work: "server" }), {
    run: "browser",
    submit: "none",
    browserOnly: true,
  })
  assert.deepEqual(plan({ platform: serverOff, context: "contest", work: "server" }), {
    run: "none",
    submit: "none",
    browserOnly: false,
  })
})

test("an organization narrows the platform, never widens it", () => {
  // Its own server switch off.
  assert.equal(plan({ org: { server: false } }).run, "browser")
  // It can't turn the server on when the platform has it off.
  assert.equal(plan({ platform: serverOff, org: { server: true } }).run, "browser")
  // Its practice needs it to opt in to browser grading.
  assert.equal(plan({ platform: serverOff, org: {} }).submit, "none")
  assert.equal(plan({ platform: serverOff, org: { browserGrading: true } }).submit, "browser")
  assert.equal(
    browserGradingAllowed({ ...all, browserGrading: false }, { browserGrading: true }),
    false
  )
})

test("work set to the browser runs and grades there, only when allowed", () => {
  const browserWork = { context: "contest" as const, work: "browser" as const }
  assert.deepEqual(plan({ ...browserWork, org: { browserGrading: true } }), {
    run: "browser",
    submit: "browser",
    browserOnly: true,
  })
  assert.equal(plan({ ...browserWork, org: {} }).submit, "none")
  assert.equal(plan({ ...browserWork, platform: { ...all, browser: false } }).run, "none")
})

test("browser languages are Python and JavaScript", () => {
  assert.ok(isBrowserLanguage("python"))
  assert.ok(isBrowserLanguage("javascript"))
  assert.ok(!isBrowserLanguage("cpp"))
})

test("a work's submission limit never goes above the platform's", () => {
  assert.equal(perMinuteLimit(12, null), 12)
  assert.equal(perMinuteLimit(12, 4), 4)
  assert.equal(perMinuteLimit(12, 40), 12)
  assert.equal(perMinuteLimit(12, 0), 1)
})

test("the form refuses limits above the platform's and browser mode that isn't allowed", () => {
  const base = {
    execution: "server" as const,
    perMinute: null,
    platform: all,
    platformPerMinute: 12,
    org: { browserGrading: true },
  }
  assert.equal(workExecutionProblem(base), null)
  assert.match(workExecutionProblem({ ...base, perMinute: 20 }) ?? "", /above/)
  assert.match(workExecutionProblem({ ...base, perMinute: 0 }) ?? "", /at least 1/)
  assert.equal(workExecutionProblem({ ...base, execution: "browser" }), null)
  assert.match(
    workExecutionProblem({ ...base, execution: "browser", org: {} }) ?? "",
    /organization/
  )
  assert.match(
    workExecutionProblem({
      ...base,
      execution: "browser",
      platform: { ...all, browserGrading: false },
    }) ?? "",
    /whole site/
  )
})

test("stored organization settings are cleaned up", () => {
  assert.deepEqual(readOrgExecution(null), {})
  assert.deepEqual(readOrgExecution({ server: false, browserGrading: "yes", x: 1 }), {
    server: false,
  })
})
