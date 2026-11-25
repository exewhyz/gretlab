import assert from "node:assert/strict"
import { test } from "node:test"

import { matchingRegions } from "./similarity.ts"

const ORIGINAL = `def solve(nums):
    best = 0
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] > best:
                best = nums[i] + nums[j]
    return best

n = int(input())
print(solve(list(map(int, input().split()))))
`

// The same program with names changed, a comment, a blank line and new code at the top.
const COPIED = `import sys
# my own work
def answer(arr):
    top = 0
    for a in range(len(arr)):
        for b in range(a + 1, len(arr)):
            if arr[a] + arr[b] > top:
                top = arr[a] + arr[b]
    return top

count = int(input())
print(answer(list(map(int, input().split()))))
`

const DIFFERENT = `values = sorted(map(int, input().split()))
print(values[-1] + values[-2])
`

test("a copy with new names: the same stretch is found in both, at its own lines", () => {
  const regions = matchingRegions(ORIGINAL, COPIED)
  assert.ok(regions.length >= 1)
  const first = regions[0]!
  // The function body (lines 1-7 of the original) lines up with lines 3-9 of the copy.
  assert.ok(first.a.from <= 2 && first.a.to >= 6, JSON.stringify(first))
  assert.ok(first.b.from <= 4 && first.b.to >= 8, JSON.stringify(first))
  // The added import and comment aren't part of any match.
  assert.ok(
    regions.every((r) => r.b.from > 2),
    JSON.stringify(regions)
  )
})

test("regions are numbered in order down the first program and don't overlap", () => {
  const regions = matchingRegions(ORIGINAL, COPIED)
  regions.forEach((r, i) => {
    assert.equal(r.id, i + 1)
    assert.ok(r.a.from <= r.a.to && r.b.from <= r.b.to)
    if (i > 0) assert.ok(r.a.from > regions[i - 1]!.a.to)
  })
})

test("a different approach shares nothing worth showing", () => {
  assert.deepEqual(matchingRegions(ORIGINAL, DIFFERENT), [])
})

test("identical code matches from its first line to its last", () => {
  const regions = matchingRegions(ORIGINAL, ORIGINAL)
  assert.equal(regions.length, 1)
  assert.deepEqual(regions[0]!.a, { from: 1, to: 10 })
  assert.deepEqual(regions[0]!.b, { from: 1, to: 10 })
})

test("empty or tiny code has no regions", () => {
  assert.deepEqual(matchingRegions("", ORIGINAL), [])
  assert.deepEqual(matchingRegions("x = 1", "x = 1"), [])
})
