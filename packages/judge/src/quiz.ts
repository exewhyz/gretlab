/*
 * Quiz questions in assignments and exams: how an answer is marked. Pure rules.
 *
 * Choice questions mark themselves. A short answer marks itself only when it matches an
 * accepted answer; anything else waits for the teacher, never marked wrong by a guess.
 * Written answers are always marked by the teacher. A teacher's mark replaces the
 * automatic one.
 */

export const QUESTION_KINDS = ["single", "multiple", "short", "written"] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

export interface QuizQuestion {
  id: string
  kind: QuestionKind
  points: number
  /** Choice questions: the right option ids. */
  correct: readonly string[]
  /** Short answers: answers that mark themselves right. */
  accepted: readonly string[]
}

/** An answer: chosen option ids, or text. */
export type QuizAnswer = string[] | string

/** Case, spacing and a trailing full stop don't matter. */
export const normalizeAnswer = (text: string) =>
  text.trim().replace(/\s+/g, " ").replace(/[.]$/, "").toLowerCase()

export interface QuestionMark {
  /** null: not answered, or waiting for the teacher. */
  earned: number | null
  needsMarking: boolean
  /** Whether a teacher set it. */
  byTeacher: boolean
}

export function markQuestion(
  question: QuizQuestion,
  answer: QuizAnswer | undefined,
  teacherMark?: number | null
): QuestionMark {
  if (typeof teacherMark === "number") {
    return {
      earned: Math.min(question.points, Math.max(0, teacherMark)),
      needsMarking: false,
      byTeacher: true,
    }
  }
  const empty =
    answer === undefined ||
    (Array.isArray(answer) ? answer.length === 0 : answer.trim() === "")
  if (empty) return { earned: 0, needsMarking: false, byTeacher: false }
  switch (question.kind) {
    case "single":
    case "multiple": {
      const chosen = new Set(Array.isArray(answer) ? answer : [answer])
      const right =
        chosen.size === question.correct.length &&
        question.correct.every((id) => chosen.has(id))
      return { earned: right ? question.points : 0, needsMarking: false, byTeacher: false }
    }
    case "short": {
      const text = normalizeAnswer(Array.isArray(answer) ? answer.join(" ") : answer)
      const right = question.accepted.some((a) => normalizeAnswer(a) === text)
      return right
        ? { earned: question.points, needsMarking: false, byTeacher: false }
        : { earned: null, needsMarking: true, byTeacher: false }
    }
    case "written":
      return { earned: null, needsMarking: true, byTeacher: false }
  }
}
