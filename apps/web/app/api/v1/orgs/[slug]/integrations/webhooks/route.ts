import { route } from "@/lib/api/route"
import { createWebhook, webhookSchema } from "@/features/integrations/server"

/** A new webhook; the answer is the only time its signing secret is shown. */
export const POST = route({ access: "user", body: webhookSchema }, ({ user, params, body }) =>
  createWebhook(params.slug ?? "", user, body)
)
