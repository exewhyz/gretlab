import assert from "node:assert/strict"
import { test } from "node:test"

import { orgLimitsProblem, readOrgLimits, submissionLimits } from "./limits.ts"

const python = { id: "python", timeLimitMs: 5000, memoryLimitMb: 256 }
const ceiling = { timeMs: 10_000, memoryMb: 1024 }

test("without an organization or a problem's own limit, the language's default applies", () => {
  assert.deepEqual(
    submissionLimits({ problem: null, language: python, org: null, ceiling }),
    { timeLimitMs: 5000, memoryLimitMb: 256 }
  )
})

test("an organization's limit for the language replaces the platform's default", () => {
  const org = { python: { timeLimitMs: 8000, memoryLimitMb: 512 } }
  assert.deepEqual(
    submissionLimits({ problem: null, language: python, org, ceiling }),
    { timeLimitMs: 8000, memoryLimitMb: 512 }
  )
})

test("an organization may set only one of the two; the other stays the default", () => {
  const org = { python: { memoryLimitMb: 128 } }
  assert.deepEqual(
    submissionLimits({ problem: null, language: python, org, ceiling }),
    { timeLimitMs: 5000, memoryLimitMb: 128 }
  )
})

test("another language's limit doesn't apply", () => {
  const org = { cpp: { timeLimitMs: 1000 } }
  assert.deepEqual(
    submissionLimits({ problem: null, language: python, org, ceiling }),
    { timeLimitMs: 5000, memoryLimitMb: 256 }
  )
})

test("a problem's own limit wins over the organization's", () => {
  const org = { python: { timeLimitMs: 8000, memoryLimitMb: 512 } }
  const problem = { timeLimitMs: 1000, memoryLimitMb: null }
  assert.deepEqual(
    submissionLimits({ problem, language: python, org, ceiling }),
    { timeLimitMs: 1000, memoryLimitMb: 512 }
  )
})

test("an organization's limit is held under the ceiling, even one saved before it was lowered", () => {
  const org = { python: { timeLimitMs: 30_000, memoryLimitMb: 4096 } }
  assert.deepEqual(
    submissionLimits({ problem: null, language: python, org, ceiling }),
    { timeLimitMs: 10_000, memoryLimitMb: 1024 }
  )
})

test("reading stored limits keeps only whole, positive numbers", () => {
  assert.deepEqual(readOrgLimits(null), {})
  assert.deepEqual(readOrgLimits("nonsense"), {})
  assert.deepEqual(
    readOrgLimits({
      python: { timeLimitMs: 3000, memoryLimitMb: "lots" },
      java: { timeLimitMs: -1 },
      cpp: 5,
    }),
    { python: { timeLimitMs: 3000 } }
  )
})

test("saving: within the ceiling and known languages is fine", () => {
  const known = ["python", "cpp"]
  assert.equal(
    orgLimitsProblem(
      { python: { timeLimitMs: 10_000, memoryLimitMb: 1024 } },
      known,
      ceiling
    ),
    null
  )
  assert.equal(orgLimitsProblem({}, known, ceiling), null)
})

test("saving: past the ceiling, too small or an unknown language is refused", () => {
  const known = ["python", "cpp"]
  assert.match(
    orgLimitsProblem({ python: { timeLimitMs: 10_001 } }, known, ceiling)!,
    /10 s/
  )
  assert.match(
    orgLimitsProblem({ cpp: { memoryLimitMb: 2048 } }, known, ceiling)!,
    /1024 MB/
  )
  assert.match(
    orgLimitsProblem({ cpp: { timeLimitMs: 50 } }, known, ceiling)!,
    /at least/
  )
  assert.match(
    orgLimitsProblem({ cpp: { memoryLimitMb: 16 } }, known, ceiling)!,
    /at least/
  )
  assert.match(
    orgLimitsProblem({ cobol: { timeLimitMs: 1000 } }, known, ceiling)!,
    /cobol/
  )
})
