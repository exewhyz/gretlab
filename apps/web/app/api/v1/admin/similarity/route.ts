import { z } from "zod"

import { route } from "@/lib/api/route"
import { findSimilarSubmissions } from "@/features/catalog/server"

export const POST = route(
  {
    access: "teacher",
    body: z.object({
      problemSlug: z.string(),
      contestSlug: z.string().nullable(),
      threshold: z.number().min(0.3).max(1),
    }),
  },
  ({ body }) => findSimilarSubmissions(body)
)
