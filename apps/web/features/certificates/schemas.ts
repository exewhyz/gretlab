import { z } from "zod"

/** Browser-safe: forms load this. */

export const issueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("course"), courseId: z.uuid() }),
  z.object({
    kind: z.literal("custom"),
    userIds: z.array(z.uuid()).min(1, "Choose who gets it").max(500),
    title: z.string().trim().min(1, "Name the certificate").max(200),
    detail: z.string().trim().max(500).default(""),
  }),
])

export type IssueInput = z.infer<typeof issueSchema>
