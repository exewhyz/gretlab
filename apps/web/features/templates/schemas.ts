import { z } from "zod"

/** Browser-safe: forms load this. A template is saved with the assignment form's body. */

export const applyTemplateSchema = z.object({
  published: z.boolean().default(false),
  uses: z
    .array(
      z
        .object({
          /** A class (organizations); null is the whole owner (the platform, or a whole college). */
          groupId: z.uuid().nullable(),
          opensAt: z.coerce.date({ error: "Choose when it opens" }),
          dueAt: z.coerce.date({ error: "Choose a due time" }),
        })
        .refine((u) => u.dueAt > u.opensAt, { message: "The due time must be after it opens", path: ["dueAt"] })
    )
    .min(1, "Add at least one class")
    .max(50, "At most 50 at once"),
})

export const fromAssignmentSchema = z.object({ assignmentId: z.uuid() })

export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>
