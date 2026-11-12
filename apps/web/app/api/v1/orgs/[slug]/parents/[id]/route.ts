import { route } from "@/lib/api/route"
import { unlinkParent } from "@/features/parents/server"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  unlinkParent(params.slug ?? "", user, params.id ?? "")
)
