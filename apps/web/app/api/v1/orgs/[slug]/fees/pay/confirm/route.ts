import { route } from "@/lib/api/route"
import {
  confirmOnlinePayment,
  confirmOnlineSchema,
} from "@/features/fees/online"

/** The checkout's answer: its signature checked with the institution's key, then applied. */
export const POST = route(
  { access: "user", body: confirmOnlineSchema },
  ({ user, params, body }) =>
    confirmOnlinePayment(params.slug ?? "", user, body)
)
