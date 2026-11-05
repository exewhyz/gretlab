import { route } from "@/lib/api/route"
import { getContestView } from "@/features/contests/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  return getContestView(params.slug ?? "", user)
})
