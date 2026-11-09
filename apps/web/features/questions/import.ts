import { z } from "zod"

import { questionInputSchema, type QuestionInput } from "./schemas"

/*
 * The question file: one format for every import (the question bank, and the pickers of
 * assignments, exams and contests). Documented in docs/question-format.md; template at
 * /question-template.json. Options are a plain list of texts; the right ones are named by
 * their letter (A, B…) or their text.
 */

const importedQuestion = z.object({
  title: z.string().optional(),
  kind: z.enum(["single", "multiple", "short", "written"]),
  question: z.string(),
  options: z.array(z.string()).default([]),
  /** Letters ("A", "C") or option texts. */
  answer: z.union([z.string(), z.array(z.string())]).optional(),
  /** Short answers: accepted answers. */
  accepted: z.array(z.string()).default([]),
  explanation: z.string().default(""),
  points: z.number().int().default(1),
  tags: z.array(z.string()).default([]),
})

const fileSchema = z.union([
  z.object({
    format: z.literal("gretlab-questions").optional(),
    version: z.literal(1).optional(),
    questions: z.array(z.unknown()),
  }),
  z.array(z.unknown()),
])

const LETTERS = "abcdefghij"

function toInput(raw: z.infer<typeof importedQuestion>): unknown {
  const options = raw.options.map((text, i) => ({ id: LETTERS[i] ?? `o${i}`, text }))
  const named = raw.answer === undefined ? [] : Array.isArray(raw.answer) ? raw.answer : [raw.answer]
  const correct = named.map((n) => {
    const letter = n.trim().toLowerCase()
    if (/^[a-j]$/.test(letter) && options.some((o) => o.id === letter)) return letter
    return options.find((o) => o.text.trim().toLowerCase() === letter)?.id ?? `?${n}`
  })
  const title =
    raw.title?.trim() ||
    raw.question.replace(/[#*`_>\[\]]/g, "").trim().split("\n")[0]!.slice(0, 80)
  return {
    title,
    kind: raw.kind,
    prompt: raw.question,
    options,
    correct: raw.kind === "single" || raw.kind === "multiple" ? correct : [],
    // A short answer's "answer" is one more accepted answer.
    accepted: raw.kind === "short" ? [...raw.accepted, ...named] : [],
    explanation: raw.explanation,
    points: raw.points,
    tags: raw.tags,
    published: true,
  }
}

/** Questions in a file, each checked; errors name the question and the field. */
export function readQuestionFile(raw: unknown) {
  const file = fileSchema.safeParse(raw)
  if (!file.success) {
    return { questions: [] as QuestionInput[], errors: ["The file isn't a question file. See the template."] }
  }
  const list = Array.isArray(file.data) ? file.data : file.data.questions
  const questions: QuestionInput[] = []
  const errors: string[] = []
  if (list.length === 0) errors.push("The file has no questions.")
  if (list.length > 500) errors.push("At most 500 questions per file.")
  list.slice(0, 500).forEach((item, index) => {
    const shaped = importedQuestion.safeParse(item)
    const parsed = shaped.success ? questionInputSchema.safeParse(toInput(shaped.data)) : shaped
    if (parsed.success) return void questions.push(parsed.data as QuestionInput)
    const issue = parsed.error.issues[0]!
    const name = item && typeof item === "object" && "question" in item ? String(item.question).slice(0, 40) : ""
    errors.push(
      `Question ${index + 1}${name ? ` (${name})` : ""}: ${issue.path.join(".") || "it"}: ${issue.message}`
    )
  })
  return { questions, errors }
}

export const questionImportSchema = z.object({
  file: z.unknown(),
  /** Drafts (only their writers can use them) or ready. */
  published: z.boolean().default(true),
})
