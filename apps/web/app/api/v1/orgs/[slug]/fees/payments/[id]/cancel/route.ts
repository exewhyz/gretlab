import { route } from "@/lib/api/route"
import { cancelReceipt, cancelSchema } from "@/features/fees/ledger"

/** Cancels a receipt with a reason: a protected action (a code from the last 10 minutes). */
export const POST = route(
  { access: "user", body: cancelSchema, stepUp: true },
  ({ user, params, body }) =>
    cancelReceipt(params.slug ?? "", user, params.id ?? "", body)
)
