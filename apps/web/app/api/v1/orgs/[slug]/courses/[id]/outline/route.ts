import { route } from "@/lib/api/route"
import { orgSaveOutline } from "@/features/courses/org"
import { outlineSchema } from "@/features/courses/schemas"

export const PUT = route({ access: "user", body: outlineSchema }, ({ user, params, body }) =>
  orgSaveOutline(params.slug ?? "", user, params.id ?? "", body)
)
