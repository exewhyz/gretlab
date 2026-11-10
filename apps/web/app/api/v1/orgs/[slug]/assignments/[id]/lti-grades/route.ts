import { route } from "@/lib/api/route"
import { orgGradeTargets, orgSendGrades } from "@/features/lti/org"

/** The LMS gradebook columns this assignment's grades can go to. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgGradeTargets(params.slug ?? "", user, params.id ?? "")
)

/** Sends every student's current total to them. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgSendGrades(params.slug ?? "", user, params.id ?? "")
)
