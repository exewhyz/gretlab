import { route } from "@/lib/api/route"
import { assignRole } from "@/features/orgs/server"
import { assignRoleSchema } from "@/features/orgs/schemas"

export const POST = route(
  { access: "user", body: assignRoleSchema },
  ({ user, params, body }) =>
    assignRole(params.slug ?? "", user, params.userId ?? "", body)
)
