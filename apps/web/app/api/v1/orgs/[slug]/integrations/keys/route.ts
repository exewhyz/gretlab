import { route } from "@/lib/api/route"
import { createApiKey, keySchema } from "@/features/integrations/server"

/** A new key; the answer is the only time its whole value is shown. */
export const POST = route({ access: "user", body: keySchema }, ({ user, params, body }) =>
  createApiKey(params.slug ?? "", user, body)
)
