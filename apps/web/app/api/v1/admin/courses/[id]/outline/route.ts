import { route } from "@/lib/api/route"
import { outlineSchema } from "@/features/courses/schemas"
import { saveOutline } from "@/features/courses/server"

export const PUT = route(
  { access: "platform.library.manage", body: outlineSchema },
  ({ user, params, body }) => saveOutline(null, params.id ?? "", body, user.id)
)
