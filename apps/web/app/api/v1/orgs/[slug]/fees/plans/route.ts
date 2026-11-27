import { route } from "@/lib/api/route"
import { savePlan } from "@/features/fees/server"
import { feePlanSchema } from "@/features/fees/schemas"

export const POST = route(
  { access: "user", body: feePlanSchema },
  ({ user, params, body }) => savePlan(params.slug ?? "", user, null, body)
)
