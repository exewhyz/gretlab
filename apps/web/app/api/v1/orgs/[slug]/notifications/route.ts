import { policyOverridesSchema } from "@workspace/judge"

import { route } from "@/lib/api/route"
import {
  orgPolicyView,
  saveOrgPolicy,
} from "@/features/notifications/policy-admin"

/** Which notifications this organization sends, within what the platform allows. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgPolicyView(params.slug ?? "", user)
)

export const PUT = route(
  { access: "user", body: policyOverridesSchema },
  ({ user, params, body }) => saveOrgPolicy(params.slug ?? "", user, body)
)
