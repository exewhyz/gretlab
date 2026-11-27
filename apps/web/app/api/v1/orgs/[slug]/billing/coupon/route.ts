import { route } from "@/lib/api/route"
import { couponSchema, previewCoupon } from "@/features/billing/pay"

/** Apply: what one code takes off the plan as chosen, before paying. Makes no order. */
export const POST = route(
  { access: "user", body: couponSchema },
  ({ user, params, body }) => previewCoupon(params.slug ?? "", user, body)
)
