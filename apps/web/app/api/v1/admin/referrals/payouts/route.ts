import { payoutSchema, settleEarnings } from "@/features/referrals/server"
import { route } from "@/lib/api/route"

/** Marks earnings paid out (by hand), void, or owed again. A protected action. */
export const POST = route(
  { access: "platform.referrals.manage", body: payoutSchema, stepUp: true },
  ({ user, body }) => settleEarnings(user, body)
)
