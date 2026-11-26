import { brandingSchema } from "@workspace/judge"

import { getBranding, saveAccent } from "@/features/orgs/branding"
import { route } from "@/lib/api/route"

/** The organization's logo and brand colour (Manage › Settings › Branding). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getBranding(params.slug ?? "", user)
)

export const PUT = route(
  { access: "user", body: brandingSchema },
  ({ user, params, body }) => saveAccent(params.slug ?? "", user, body.accent)
)
