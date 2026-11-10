import { z } from "zod"

/** Browser-safe: forms load this. */

export const projectSubmitSchema = z.object({
  url: z.string().trim().min(1, "Paste your repository's link").max(500),
  note: z.string().max(2000).default(""),
})

export const projectMarkSchema = z.object({
  student: z.email(),
  projectId: z.uuid(),
  /** Null clears the mark. */
  mark: z.number().int().min(0).max(1000).nullable(),
  feedback: z.string().max(10_000).default(""),
})
