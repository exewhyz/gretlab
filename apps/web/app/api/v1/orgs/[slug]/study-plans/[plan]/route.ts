import { route } from "@/lib/api/route"
import {
  deleteOrgPlan,
  orgPlanUpdateSchema,
  orgStudyPlan,
  updateOrgPlan,
} from "@/features/catalog/org-plans"

/** One study plan with its problems, where each is solved, and the viewer's progress. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgStudyPlan(params.slug ?? "", user, params.plan ?? "")
)

export const PATCH = route(
  { access: "user", body: orgPlanUpdateSchema },
  ({ user, params, body }) =>
    updateOrgPlan(params.slug ?? "", user, params.plan ?? "", body)
)

export const DELETE = route(
  { stepUp: true, access: "user" },
  ({ user, params }) =>
    deleteOrgPlan(params.slug ?? "", user, params.plan ?? "")
)
