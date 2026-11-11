import { policyOverridesSchema } from "@workspace/judge"

import { route } from "@/lib/api/route"
import {
  platformPolicyView,
  savePlatformPolicy,
} from "@/features/notifications/policy-admin"

/** Which notifications the platform allows; organizations choose within these. */
export const GET = route({ access: "platform.notifications.manage" }, () =>
  platformPolicyView()
)

export const PUT = route(
  { access: "platform.notifications.manage", body: policyOverridesSchema },
  ({ user, body }) => savePlatformPolicy(user, body)
)
