import { route } from "@/lib/api/route"
import { contestProblemWithVirtual } from "@/features/contests/virtual"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  return contestProblemWithVirtual(params.slug ?? "", params.label ?? "", user)
})
