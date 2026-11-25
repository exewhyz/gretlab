/*
 * Feedback rounds (features/feedback): an organization opens a round ("Semester 1 faculty
 * feedback") for some classes between two dates; each student rates each teacher who teaches them
 * a subject there (Subjects module). Pure rules, unit-tested: a round's phase, checking answers,
 * and results that stay hidden until enough people have answered that nobody can be picked out.
 */

export interface FeedbackQuestion {
  id: string
  /** "rating": 1 to 5, required. "comment": free text, optional. */
  kind: "rating" | "comment"
  text: string
}

/** What a new round starts with; the person opening it may change them. */
export const DEFAULT_FEEDBACK_QUESTIONS: FeedbackQuestion[] = [
  { id: "clear", kind: "rating", text: "Explains clearly" },
  { id: "prepared", kind: "rating", text: "Comes prepared and organised" },
  { id: "doubts", kind: "rating", text: "Answers doubts and questions" },
  { id: "pace", kind: "rating", text: "Keeps a pace I can follow" },
  {
    id: "overall",
    kind: "rating",
    text: "Overall, the teaching in this subject",
  },
  {
    id: "comment",
    kind: "comment",
    text: "Anything you'd like the teacher to know?",
  },
]

/** Results show only once this many students have answered for a teacher and subject. */
export const MIN_RESPONSES = 3

/** A comment's longest. */
export const MAX_COMMENT = 1000

export type RoundPhase = "upcoming" | "open" | "closed"

export function roundPhase(
  opensAt: Date,
  closesAt: Date,
  now: Date
): RoundPhase {
  if (now < opensAt) return "upcoming"
  if (now < closesAt) return "open"
  return "closed"
}

export type Answers = Record<string, number | string>

/** A student's answers checked against the round's questions; only known questions, trimmed. */
export function checkAnswers(
  questions: FeedbackQuestion[],
  given: Record<string, unknown>
): { ok: true; answers: Answers } | { ok: false; reason: string } {
  const known = new Set(questions.map((q) => q.id))
  if (Object.keys(given).some((k) => !known.has(k)))
    return {
      ok: false,
      reason: "An answer is for a question this round doesn't have.",
    }
  const answers: Answers = {}
  for (const q of questions) {
    const value = given[q.id]
    if (q.kind === "rating") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 5
      )
        return { ok: false, reason: `Rate "${q.text}" from 1 to 5.` }
      answers[q.id] = value
    } else if (value !== undefined && value !== null) {
      if (typeof value !== "string")
        return { ok: false, reason: "A comment is text." }
      const text = value.trim()
      if (text.length > MAX_COMMENT)
        return {
          ok: false,
          reason: `Keep the comment under ${MAX_COMMENT} characters.`,
        }
      if (text) answers[q.id] = text
    }
  }
  return { ok: true, answers }
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10

/**
 * One teacher's results for one subject: each rating question's average and the comments, with
 * nothing (only the count) below MIN_RESPONSES. Comments come without who wrote them.
 */
export function summarizeFeedback(
  questions: FeedbackQuestion[],
  all: Answers[]
) {
  const responses = all.length
  if (responses < MIN_RESPONSES)
    return {
      shown: false as const,
      responses,
      overall: null,
      questions: [],
      comments: [],
    }
  const ratings = questions.filter((q) => q.kind === "rating")
  let sum = 0
  let n = 0
  const perQuestion = ratings.map((q) => {
    const values = all
      .map((a) => a[q.id])
      .filter((v): v is number => typeof v === "number")
    const total = values.reduce((s, v) => s + v, 0)
    sum += total
    n += values.length
    return {
      id: q.id,
      text: q.text,
      average: values.length ? oneDecimal(total / values.length) : 0,
      count: values.length,
    }
  })
  const comments = questions
    .filter((q) => q.kind === "comment")
    .flatMap((q) =>
      all
        .map((a) => a[q.id])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
    // Alphabetical, so the order says nothing about who answered when.
    .sort((x, y) => x.localeCompare(y))
  return {
    shown: true as const,
    responses,
    overall: n ? oneDecimal(sum / n) : null,
    questions: perQuestion,
    comments,
  }
}
