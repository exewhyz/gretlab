import { route } from "@/lib/api/route"
import { updateUser, userUpdateSchema } from "@/features/admin/server"

export const PATCH = route(
  { access: "platform.users.manage", body: userUpdateSchema },
  ({ user, params, body }) => updateUser(user, params.id ?? "", body)
)
