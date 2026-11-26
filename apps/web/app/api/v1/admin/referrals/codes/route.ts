import { codeInputSchema, saveCode } from "@/features/referrals/server"
import { route } from "@/lib/api/route"

/** Makes or changes a creator link or campaign coupon. */
export const POST = route(
  { access: "platform.referrals.manage", body: codeInputSchema },
  ({ user, body }) => saveCode(user, body)
)
