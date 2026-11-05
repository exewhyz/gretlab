import { route } from "@/lib/api/route"
import { getOrganization, updateSettings } from "@/features/orgs/server"
import { orgSettingsSchema } from "@/features/orgs/schemas"

export const GET = route({ access: "public" }, ({ user, params }) =>
  getOrganization(params.slug ?? "", user)
)

export const PATCH = route(
  { access: "user", body: orgSettingsSchema },
  ({ user, params, body }) => updateSettings(params.slug ?? "", user, body)
)
