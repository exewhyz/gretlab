import { route } from "@/lib/api/route"
import { payOnlineSchema, startOnlinePayment } from "@/features/fees/online"

/** A student or a linked parent starts paying online: an order in the institution's Razorpay. */
export const POST = route(
  { access: "user", body: payOnlineSchema },
  ({ user, params, body }) => startOnlinePayment(params.slug ?? "", user, body)
)
