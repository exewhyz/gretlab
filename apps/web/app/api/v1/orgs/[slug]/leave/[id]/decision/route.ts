import { route } from "@/lib/api/route"
import { decideLeave, decisionSchema } from "@/features/leave/server"

/** Approves or refuses a waiting request. */
export const POST = route(
  { access: "user", body: decisionSchema },
  ({ user, params, body }) =>
    decideLeave(params.slug ?? "", user, params.id ?? "", body)
)
