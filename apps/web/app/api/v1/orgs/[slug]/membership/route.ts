import { route } from "@/lib/api/route"
import { leaveOrganization, setShareProgress } from "@/features/orgs/server"
import { joinSchema } from "@/features/orgs/schemas"

/** The viewer's own membership: change what they share, or leave. */
export const PATCH = route(
  { access: "user", body: joinSchema },
  ({ user, params, body }) =>
    setShareProgress(params.slug ?? "", user, body.shareProgress)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  leaveOrganization(params.slug ?? "", user)
)
