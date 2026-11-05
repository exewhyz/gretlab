import { route } from "@/lib/api/route"
import { getMembership } from "@/features/catalog/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "user" }, async ({ user, params }) => {
  await requireFeature("lists.enabled")
  return getMembership(user, params.slug ?? "")
})
