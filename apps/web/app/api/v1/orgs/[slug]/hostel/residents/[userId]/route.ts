import { route } from "@/lib/api/route"
import { vacate } from "@/features/hostel/server"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  vacate(params.slug ?? "", user, params.userId ?? "")
)
