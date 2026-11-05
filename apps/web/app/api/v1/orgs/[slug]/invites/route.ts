import { route } from "@/lib/api/route"
import { createInvite, listInvites } from "@/features/orgs/server"
import { inviteSchema } from "@/features/orgs/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  listInvites(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: inviteSchema },
  ({ user, params, body }) => createInvite(params.slug ?? "", user, body)
)
