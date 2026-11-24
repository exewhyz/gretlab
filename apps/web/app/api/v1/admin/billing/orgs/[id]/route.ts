import { route } from "@/lib/api/route"
import { setOrgPlan, setPlanSchema } from "@/features/billing/server"

/** Sets an organization's plan by hand: custom deals, pilots, payments taken outside. */
export const PUT = route(
  { stepUp: true, access: "platform.billing.manage", body: setPlanSchema },
  ({ user, params, body }) => setOrgPlan(user, params.id ?? "", body)
)
