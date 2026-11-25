import { route } from "@/lib/api/route"
import { answerRound, answerSchema } from "@/features/feedback-rounds/server"

/** A student's answers about one teacher of one subject. */
export const POST = route(
  { access: "user", body: answerSchema },
  ({ user, params, body }) =>
    answerRound(params.slug ?? "", user, params.id ?? "", body)
)
