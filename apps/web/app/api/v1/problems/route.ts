import { route } from "@/lib/api/route"
import { listPublicProblems } from "@/features/problems/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async () => {
  await requireFeature("practice.enabled")
  return listPublicProblems()
})
