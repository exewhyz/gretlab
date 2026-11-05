import { route } from "@/lib/api/route"
import { getLeaderboard } from "@/features/catalog/server"

export const GET = route({ access: "user" }, () => getLeaderboard())
