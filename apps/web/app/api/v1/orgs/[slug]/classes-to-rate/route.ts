import { route } from "@/lib/api/route"
import { classesToRate } from "@/features/teaching/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  classesToRate(params.slug ?? "", user)
)
