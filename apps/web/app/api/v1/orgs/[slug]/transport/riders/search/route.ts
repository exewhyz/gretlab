import { route } from "@/lib/api/route"
import { searchRiders } from "@/features/transport/server"

export const GET = route({ access: "user" }, ({ user, params, query }) =>
  searchRiders(params.slug ?? "", user, query.get("q") ?? "")
)
