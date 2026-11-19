import { route } from "@/lib/api/route"
import {
  orgFeatures,
  orgFeaturesSchema,
  saveOrgFeatures,
} from "@/features/orgs/kinds"

/** The platform's module levels for one organization, over its kind's. */
export const GET = route(
  { access: ["platform.orgs.manage", "platform.kinds.manage"] },
  ({ user, params }) => orgFeatures(user, params.id ?? "")
)

export const PUT = route(
  {
    access: ["platform.orgs.manage", "platform.kinds.manage"],
    body: orgFeaturesSchema,
  },
  ({ user, params, body }) => saveOrgFeatures(user, params.id ?? "", body)
)
