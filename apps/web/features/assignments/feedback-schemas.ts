import { BROWSER_EXAM_EVENTS } from "@workspace/judge"
import { z } from "zod"

export const rubricMarksSchema = z.object({
  student: z.email(),
  problemId: z.uuid(),
  marks: z.record(z.string().max(40), z.number().min(0).max(1000)),
})

export const lineCommentSchema = z.object({
  student: z.email(),
  submissionId: z.uuid(),
  path: z.string().min(1).max(200),
  line: z.number().int().min(1).max(100_000),
  body: z.string().trim().min(1, "Write the comment first").max(4000),
})

export const snippetSchema = z.object({
  body: z.string().trim().min(1, "Write the comment first").max(4000),
})

export const extendSchema = z.object({
  student: z.email(),
  minutes: z.number().int().min(1, "At least a minute").max(600, "At most 10 hours"),
})

export const examEventSchema = z.object({
  // The server records other kinds (another network) itself.
  kind: z.enum(BROWSER_EXAM_EVENTS),
  detail: z.string().max(200).optional(),
})

export const extensionSchema = z.object({
  student: z.email(),
  dueAt: z.coerce.date({ error: "Choose the new due time" }),
  /** Problems it reopens; empty for the whole assignment. */
  problemIds: z.array(z.uuid()).max(50).default([]),
  reason: z.string().trim().max(500).default(""),
})

export const quizAnswersSchema = z.object({
  answers: z.record(
    z.uuid(),
    z.union([z.array(z.string().max(20)).max(10), z.string().max(20_000)])
  ),
})

export const quizMarksSchema = z.object({
  student: z.email(),
  marks: z.record(z.uuid(), z.number().min(0).max(1000).nullable()),
})
