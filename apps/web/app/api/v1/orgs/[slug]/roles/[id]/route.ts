import { route } from "@/lib/api/route"
import { deleteRole, updateRole } from "@/features/orgs/server"
import { roleSchema } from "@/features/orgs/schemas"

export const PUT = route(
  { access: "user", body: roleSchema },
  ({ user, params, body }) =>
    updateRole(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteRole(params.slug ?? "", user, params.id ?? "")
)
