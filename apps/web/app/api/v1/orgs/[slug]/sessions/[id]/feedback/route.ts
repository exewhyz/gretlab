import { route } from "@/lib/api/route"
import { feedbackSchema, rateClass } from "@/features/teaching/server"

/** A student rates a class they were in. */
export const POST = route(
  { access: "user", body: feedbackSchema },
  ({ user, params, body }) =>
    rateClass(params.slug ?? "", user, params.id ?? "", body)
)
