import { route } from "@/lib/api/route"
import { orgBilling } from "@/features/billing/server"

/** The organization's plan, use, prices to build a new one, billing details and payments. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgBilling(params.slug ?? "", user)
)
