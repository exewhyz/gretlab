import { route } from "@/lib/api/route"
import { listIntegrations } from "@/features/integrations/server"

/** The organization's API keys and webhooks, for those who run its settings. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  listIntegrations(params.slug ?? "", user)
)
