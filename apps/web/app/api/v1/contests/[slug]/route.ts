import { route } from "@/lib/api/route"
import { contestViewWithVirtual } from "@/features/contests/virtual"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  return contestViewWithVirtual(params.slug ?? "", user)
})
