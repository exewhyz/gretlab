import { route } from "@/lib/api/route"
import { deleteSession } from "@/features/teaching/server"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteSession(params.slug ?? "", user, params.id ?? "")
)
