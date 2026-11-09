import { z } from "zod"

import { route } from "@/lib/api/route"
import { answerContestQuestion } from "@/features/contests/server"

/** Your one answer to a contest question, marked at once. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      answer: z.union([z.array(z.string().max(20)).max(10), z.string().max(2000)]),
    }),
  },
  ({ user, params, body }) =>
    answerContestQuestion(params.slug ?? "", params.questionId ?? "", user, body.answer)
)
