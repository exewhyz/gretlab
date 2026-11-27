import { route } from "@/lib/api/route"
import { saveFeeSettings } from "@/features/fees/server"
import { feeSettingsSchema } from "@/features/fees/schemas"

/** Receipt numbering, the GSTIN and the institution's own Razorpay keys: a protected action. */
export const PUT = route(
  { access: "user", body: feeSettingsSchema, stepUp: true },
  ({ user, params, body }) => saveFeeSettings(params.slug ?? "", user, body)
)
