import { route } from "@/lib/api/route"
import { confirm, confirmSchema } from "@/features/billing/pay"

/** Razorpay's checkout answer, applied once its signature checks. */
export const POST = route(
  { access: "user", body: confirmSchema },
  ({ user, params, body }) => confirm(params.slug ?? "", user, body)
)
