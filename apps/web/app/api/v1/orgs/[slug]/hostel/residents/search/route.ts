import { route } from "@/lib/api/route"
import { searchResidents } from "@/features/hostel/server"

export const GET = route({ access: "user" }, ({ user, params, query }) =>
  searchResidents(params.slug ?? "", user, query.get("q") ?? "")
)
