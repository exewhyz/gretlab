import { route } from "@/lib/api/route"
import { virtualLeaderboard } from "@/features/contests/virtual"

/** The virtual taker's board: the real contestants at the same minute, with them among them. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  virtualLeaderboard(params.slug ?? "", user)
)
