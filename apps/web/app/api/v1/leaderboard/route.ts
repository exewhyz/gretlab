import { route } from "@/lib/api/route"
import { getLeaderboard } from "@/features/catalog/server"

/** ?scope=personal,<org slug>,… (the header's organization switcher); none is everything. */
export const GET = route({ access: "user" }, ({ user, query }) =>
  getLeaderboard(user, query.get("scope"))
)
