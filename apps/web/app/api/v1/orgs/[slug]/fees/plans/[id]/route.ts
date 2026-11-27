import { route } from "@/lib/api/route"
import { deletePlan, savePlan } from "@/features/fees/server"
import { feePlanSchema } from "@/features/fees/schemas"

export const PUT = route(
  { access: "user", body: feePlanSchema },
  ({ user, params, body }) =>
    savePlan(params.slug ?? "", user, params.id ?? "", body)
)

/** Deleting a plan is a protected action (a code from the last 10 minutes). */
export const DELETE = route(
  { access: "user", stepUp: true },
  ({ user, params }) => deletePlan(params.slug ?? "", user, params.id ?? "")
)
