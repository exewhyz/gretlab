import { route } from "@/lib/api/route"
import {
  billingProfileSchema,
  saveBillingProfile,
} from "@/features/billing/server"

/** Who the invoices are for: legal name, GSTIN, address, billing email. */
export const PUT = route(
  { access: "user", body: billingProfileSchema },
  ({ user, params, body }) => saveBillingProfile(params.slug ?? "", user, body)
)
