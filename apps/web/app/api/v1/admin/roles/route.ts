import { route } from "@/lib/api/route"
import { roleSchema } from "@/features/platform/schemas"
import { listRoles, saveRole } from "@/features/platform/staff"

/** Built-in and custom platform roles. */
export const GET = route({ access: "platform.roles.manage" }, ({ user }) => listRoles(user))

export const POST = route(
  { access: "platform.roles.manage", body: roleSchema },
  ({ user, body }) => saveRole(user, null, body)
)
