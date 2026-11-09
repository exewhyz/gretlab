import { route } from "@/lib/api/route"
import { roleSchema } from "@/features/platform/schemas"
import { deleteRole, saveRole } from "@/features/platform/staff"

export const PUT = route(
  { access: "platform.roles.manage", body: roleSchema },
  ({ user, params, body }) => saveRole(user, params.id ?? "", body)
)

export const DELETE = route({ access: "platform.roles.manage" }, ({ user, params }) =>
  deleteRole(user, params.id ?? "")
)
