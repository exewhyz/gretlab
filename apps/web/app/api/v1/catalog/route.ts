import { route } from "@/lib/api/route"
import { getCatalog } from "@/features/catalog/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async () => {
  await requireFeature("practice.enabled")
  return getCatalog()
})
