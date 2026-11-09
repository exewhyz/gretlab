import { z } from "zod"

import { route } from "@/lib/api/route"
import { answerDaily } from "@/features/catalog/server"

/** Your one answer to one of today's questions. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      questionId: z.uuid(),
      answer: z.union([z.array(z.string().max(20)).max(10), z.string().max(2000)]),
    }),
  },
  ({ user, body }) => answerDaily(user, body.questionId, body.answer)
)
