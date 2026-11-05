import { route } from "@/lib/api/route"
import { createGroup, listGroups } from "@/features/orgs/server"
import { groupSchema } from "@/features/orgs/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  listGroups(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: groupSchema },
  ({ user, params, body }) => createGroup(params.slug ?? "", user, body)
)
