import { after } from "next/server"

import { route } from "@/lib/api/route"
import { applyDueRatings } from "@/features/contests/ratings"
import { getLeaderboard } from "@/features/contests/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  const board = await getLeaderboard(params.slug ?? "", user)
  // A rated contest that has ended and isn't rated yet: rate it (and any before it) now.
  if (board.awaitingRatings) after(() => applyDueRatings().catch(() => {}))
  return board
})
