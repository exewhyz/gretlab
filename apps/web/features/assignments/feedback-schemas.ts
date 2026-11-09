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
