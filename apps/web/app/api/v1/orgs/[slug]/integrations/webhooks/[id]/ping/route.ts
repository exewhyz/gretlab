import { route } from "@/lib/api/route"
import { pingWebhook } from "@/features/integrations/server"

/** Sends a test delivery now. */
export const POST = route({ access: "user" }, async ({ user, params }) => {
  await pingWebhook(params.slug ?? "", user, params.id ?? "")
  return { ok: true }
})
