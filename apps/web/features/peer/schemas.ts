import { z } from "zod"

/** Browser-safe: forms load this. */

export const reviewInputSchema = z.object({
  scores: z.record(z.string().max(40), z.number().int().min(0).max(1000)),
  comment: z.string().max(10_000),
  lineComments: z
    .array(
      z.object({
        path: z.string().max(200),
        line: z.number().int().min(1),
        body: z.string().trim().min(1).max(2000),
      })
    )
    .max(100),
  /** Hand it in (checked); otherwise saved as a draft. */
  submit: z.boolean(),
})

export type ReviewInput = z.infer<typeof reviewInputSchema>
