import { route } from "@/lib/api/route"
import { collectFee, collectSchema } from "@/features/fees/ledger"

/** Records a payment at the counter and numbers its receipt. */
export const POST = route(
  { access: "user", body: collectSchema },
  ({ user, params, body }) =>
    collectFee(params.slug ?? "", user, params.id ?? "", body)
)
