import { route } from "@/lib/api/route"
import { createRole, listRoles } from "@/features/orgs/server"
import { roleSchema } from "@/features/orgs/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  listRoles(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: roleSchema },
  ({ user, params, body }) => createRole(params.slug ?? "", user, body)
)
