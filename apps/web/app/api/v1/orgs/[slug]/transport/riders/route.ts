import { route } from "@/lib/api/route"
import { assignRider, riderSchema } from "@/features/transport/server"

/** Puts a member on a route and stop, or moves them. */
export const POST = route(
  { access: "user", body: riderSchema },
  ({ user, params, body }) => assignRider(params.slug ?? "", user, body)
)
