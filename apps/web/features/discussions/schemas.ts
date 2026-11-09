import { z } from "zod"

/** Browser-safe: forms load this. */

export const threadSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  body: z.string().trim().min(1, "Write something").max(20_000),
  anonymous: z.boolean().default(false),
})

export const replySchema = z.object({
  body: z.string().trim().min(1, "Write something").max(20_000),
  anonymous: z.boolean().default(false),
})

/** An author's edit, or a teacher's moderation. */
export const postChangeSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  /** Threads: the reply that answers it, or null. */
  answerId: z.uuid().nullable().optional(),
})
