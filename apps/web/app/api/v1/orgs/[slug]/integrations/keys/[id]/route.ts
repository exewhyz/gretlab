import { route } from "@/lib/api/route"
import { revokeApiKey } from "@/features/integrations/server"

export const DELETE = route({ stepUp: true, access: "user" }, async ({ user, params }) => {
  await revokeApiKey(params.slug ?? "", user, params.id ?? "")
  return { ok: true }
})
