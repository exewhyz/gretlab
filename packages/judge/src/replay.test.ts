import assert from "node:assert/strict"
import { test } from "node:test"

import { bigJumps, JUMP_CHARS } from "./replay.ts"

const at = (s: number) =>
  new Date(Date.UTC(2026, 10, 26, 10, 0, s)).toISOString()
const snap = (s: number, content: string, language = "python") => ({
  language,
  at: at(s),
  files: [{ path: "main.py", content }],
})
/** n lines of about 35 characters each, all different. */
const lines = (n: number, tag = "x") =>
  Array.from({ length: n }, (_, i) => `${tag}${i} = ${"a".repeat(30)}`).join(
    "\n"
  )

test("typing a little between saves is never a jump", () => {
  const history = [
    snap(0, "a"),
    snap(5, "a\nb = 22"),
    snap(10, "a\nb = 22\nc = 333"),
  ]
  assert.deepEqual(bigJumps(history), [])
})

test("a lot of new code in one save is a jump, with how much and the gap before it", () => {
  const history = [
    snap(0, "n = int(input())"),
    snap(4, `n = int(input())\n${lines(10)}`),
  ]
  const jumps = bigJumps(history)
  assert.equal(jumps.length, 1)
  assert.equal(jumps[0]!.step, 1)
  assert.equal(jumps[0]!.seconds, 4)
  assert.ok(jumps[0]!.added >= JUMP_CHARS, String(jumps[0]!.added))
})

test("the same code written over many saves is typing", () => {
  const history = Array.from({ length: 10 }, (_, i) =>
    snap(i * 5, lines(i + 1))
  )
  assert.deepEqual(bigJumps(history), [])
})

test("a pause doesn't excuse it: saves come seconds after typing starts again", () => {
  const history = [snap(0, "n = 1"), snap(600, `n = 1\n${lines(10)}`)]
  assert.equal(bigJumps(history).length, 1)
})

test("undoing back to code written before, or reformatting it, isn't new code", () => {
  const code = lines(10)
  const history = [
    ...Array.from({ length: 10 }, (_, i) => snap(i * 5, lines(i + 1))),
    snap(60, ""),
    snap(62, code),
    snap(64, code.replaceAll(" = ", "=")),
  ]
  assert.deepEqual(bigJumps(history), [])
})

test("the first save is measured from the starter code, not from nothing", () => {
  const starter = lines(10, "s")
  assert.deepEqual(
    bigJumps([snap(0, `${starter}\nprint(1)`)], { python: starter }),
    []
  )
  const pasted = bigJumps([snap(0, `${starter}\n${lines(10)}`)], {
    python: starter,
  })
  assert.equal(pasted.length, 1)
  assert.equal(pasted[0]!.step, 0)
  assert.equal(pasted[0]!.seconds, null)
})

test("each language starts from its own starter", () => {
  const python = lines(10, "p")
  const cpp = lines(10, "c")
  const history = [snap(0, python), snap(3, cpp, "cpp"), snap(6, python)]
  assert.deepEqual(bigJumps(history, { python, cpp }), [])
  // Without the C++ starter, switching to C++ brings in new code.
  assert.equal(bigJumps(history, { python }).length, 1)
})

test("code in several files counts together", () => {
  const history = [
    { language: "python", at: at(0), files: [{ path: "a.py", content: "" }] },
    {
      language: "python",
      at: at(2),
      files: [
        { path: "a.py", content: lines(3) },
        { path: "b.py", content: lines(3, "y") },
      ],
    },
  ]
  assert.equal(bigJumps(history).length, 1)
})
