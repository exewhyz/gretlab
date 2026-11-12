import { route } from "@/lib/api/route"
import { searchBorrowers } from "@/features/books/server"

export const GET = route({ access: "user" }, ({ user, params, query }) =>
  searchBorrowers(params.slug ?? "", user, query.get("q") ?? "")
)
