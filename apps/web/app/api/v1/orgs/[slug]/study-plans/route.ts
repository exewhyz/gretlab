import { route } from "@/lib/api/route"
import {
  createOrgPlan,
  orgPlanSchema,
  orgStudyPlans,
} from "@/features/catalog/org-plans"

/** The organization's study plans: published ones for members, all for whoever manages them. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgStudyPlans(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: orgPlanSchema },
  ({ user, params, body }) => createOrgPlan(params.slug ?? "", user, body)
)
