import { QUESTION_KINDS } from "@workspace/judge"
import { z } from "zod"

import { expectedUpdatedAt } from "@/lib/api/version"

/** A bank question as its editor saves it. Browser-safe: no server imports. */
export const questionInputSchema = z
  .object({
    expectedUpdatedAt,
    title: z.string().trim().min(1, "Give the question a short title").max(200),
    kind: z.enum(QUESTION_KINDS),
    prompt: z.string().trim().min(1, "Write the question").max(20_000),
    options: z
      .array(
        z.object({
          id: z.string().min(1).max(20),
          text: z.string().trim().min(1, "Fill in every option").max(2000),
        })
      )
      .max(10, "At most 10 options")
      .default([]),
    correct: z.array(z.string().max(20)).max(10).default([]),
    accepted: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    explanation: z.string().max(20_000).default(""),
    points: z.number({ error: "Enter the points" }).int().min(1, "At least 1 point").max(1000),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    published: z.boolean().default(true),
  })
  .superRefine((q, ctx) => {
    if (q.kind !== "single" && q.kind !== "multiple") return
    if (q.options.length < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "A choice question needs at least two options" })
    }
    const ids = q.options.map((o) => o.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Two options share an id" })
    }
    if (q.correct.length === 0 || q.correct.some((id) => !ids.includes(id))) {
      ctx.addIssue({ code: "custom", path: ["correct"], message: "Mark the right option" })
    }
    if (q.kind === "single" && q.correct.length > 1) {
      ctx.addIssue({ code: "custom", path: ["correct"], message: "A single choice question has one right option" })
    }
  })

export type QuestionInput = z.infer<typeof questionInputSchema>

/** Questions that mark themselves: the only kinds a contest or daily challenge can use. */
export const marksItself = (q: { kind: string; accepted: readonly string[] }) =>
  q.kind === "single" || q.kind === "multiple" || (q.kind === "short" && q.accepted.length > 0)
