import { route } from "@/lib/api/route"
import { acceptInvite, getInvite } from "@/features/orgs/server"
import { joinSchema } from "@/features/orgs/schemas"

/** Public, so the link can show what it's for before someone signs in. */
export const GET = route({ access: "public" }, ({ user, params }) =>
  getInvite(params.token ?? "", user)
)

export const POST = route(
  { access: "user", body: joinSchema },
  ({ user, params, body }) =>
    acceptInvite(params.token ?? "", user, body.shareProgress)
)
