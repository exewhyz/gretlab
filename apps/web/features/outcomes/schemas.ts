import { validRules } from "@workspace/judge"
import { z } from "zod"

const outcome = {
  /** Kept when editing, so tags and mappings follow the outcome. */
  id: z.uuid().optional(),
  code: z.string().trim().min(1, "Give each outcome a code, like CO1").max(20),
  title: z.string().trim().min(1, "Describe each outcome").max(500),
}

export const programOutcomesSchema = z.object({
  outcomes: z.array(z.object(outcome)).max(40, "At most 40 program outcomes"),
  rules: z
    .object({
      threshold: z.number().int().min(1).max(100),
      levels: z.tuple([
        z.number().int().min(0).max(100),
        z.number().int().min(0).max(100),
        z.number().int().min(0).max(100),
      ]),
    })
    .refine(validRules, {
      message: "Levels must rise: level 1 below level 2 below level 3",
    }),
})

export const courseOutcomesSchema = z.object({
  outcomes: z
    .array(
      z.object({
        ...outcome,
        mapping: z.record(z.uuid(), z.number().int().min(0).max(3)).default({}),
      })
    )
    .max(20, "At most 20 course outcomes"),
})

export type ProgramOutcomesInput = z.infer<typeof programOutcomesSchema>
export type CourseOutcomesInput = z.infer<typeof courseOutcomesSchema>
