import { route } from "@/lib/api/route"
import { checkout, checkoutSchema } from "@/features/billing/pay"

/** Starts paying for a plan: a Razorpay order, or a smaller plan kept for the next period. */
export const POST = route(
  { access: "user", body: checkoutSchema },
  ({ user, params, body }) => checkout(params.slug ?? "", user, body)
)
