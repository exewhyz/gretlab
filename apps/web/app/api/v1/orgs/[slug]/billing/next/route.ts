import { cancelNextPlan } from "@/features/billing/server"
import { route } from "@/lib/api/route"

/** Cancels the plan change waiting for the next period. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  cancelNextPlan(params.slug ?? "", user)
)
