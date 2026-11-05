import { route } from "@/lib/api/route"
import { getContestProblem } from "@/features/contests/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  return getContestProblem(params.slug ?? "", params.label ?? "", user)
})
