import { route } from "@/lib/api/route"
import { routeRiders } from "@/features/transport/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  routeRiders(params.slug ?? "", user, params.id ?? "")
)
