import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DEFAULT_FEEDBACK_QUESTIONS,
  MIN_RESPONSES,
  checkAnswers,
  roundPhase,
  summarizeFeedback,
  type FeedbackQuestion,
} from "./feedback.ts"

const Q: FeedbackQuestion[] = [
  { id: "a", kind: "rating", text: "Explains clearly" },
  { id: "b", kind: "rating", text: "Comes prepared" },
  { id: "c", kind: "comment", text: "Anything else?" },
]

test("a round is upcoming, open, then closed by its dates", () => {
  const opens = new Date("2026-11-25T00:00:00Z")
  const closes = new Date("2026-12-01T00:00:00Z")
  assert.equal(
    roundPhase(opens, closes, new Date("2026-11-24T23:59:59Z")),
    "upcoming"
  )
  assert.equal(
    roundPhase(opens, closes, new Date("2026-11-25T00:00:00Z")),
    "open"
  )
  assert.equal(
    roundPhase(opens, closes, new Date("2026-12-01T00:00:00Z")),
    "closed"
  )
})

test("answers: every rating 1 to 5, a comment optional and trimmed, nothing else", () => {
  assert.deepEqual(checkAnswers(Q, { a: 5, b: 1, c: "  Good  " }), {
    ok: true,
    answers: { a: 5, b: 1, c: "Good" },
  })
  assert.deepEqual(checkAnswers(Q, { a: 5, b: 3 }), {
    ok: true,
    answers: { a: 5, b: 3 },
  })
  assert.equal(checkAnswers(Q, { a: 5 }).ok, false)
  assert.equal(checkAnswers(Q, { a: 6, b: 3 }).ok, false)
  assert.equal(checkAnswers(Q, { a: 2.5, b: 3 }).ok, false)
  assert.equal(checkAnswers(Q, { a: 5, b: 3, c: "x".repeat(1001) }).ok, false)
  assert.equal(checkAnswers(Q, { a: 5, b: 3, z: 4 }).ok, false)
})

test("results stay hidden until enough people have answered, so nobody can be picked out", () => {
  const few = summarizeFeedback(
    Q,
    Array.from({ length: MIN_RESPONSES - 1 }, () => ({ a: 5, b: 4 }))
  )
  assert.equal(few.shown, false)
  assert.equal(few.responses, MIN_RESPONSES - 1)
  assert.deepEqual(few.questions, [])
  assert.deepEqual(few.comments, [])
})

test("enough answers: each rating's average to one decimal, comments without who wrote them", () => {
  const out = summarizeFeedback(Q, [
    { a: 5, b: 4, c: "Clear" },
    { a: 4, b: 4 },
    { a: 4, b: 3, c: "Faster please" },
  ])
  assert.equal(out.shown, true)
  assert.deepEqual(
    out.questions.map((q) => [q.id, q.average, q.count]),
    [
      ["a", 4.3, 3],
      ["b", 3.7, 3],
    ]
  )
  assert.deepEqual([...out.comments].sort(), ["Clear", "Faster please"])
  assert.equal(out.overall, 4)
})

test("the default questions are ratings and one comment, each with an id", () => {
  assert.ok(
    DEFAULT_FEEDBACK_QUESTIONS.filter((q) => q.kind === "rating").length >= 3
  )
  assert.equal(
    DEFAULT_FEEDBACK_QUESTIONS.filter((q) => q.kind === "comment").length,
    1
  )
  assert.equal(
    new Set(DEFAULT_FEEDBACK_QUESTIONS.map((q) => q.id)).size,
    DEFAULT_FEEDBACK_QUESTIONS.length
  )
})
