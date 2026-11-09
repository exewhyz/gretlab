import { route } from "@/lib/api/route"
import { getAssignmentProblem } from "@/features/assignments/server"

/** One problem of an assignment, numbered by the assignment (1, 2, …). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getAssignmentProblem(params.slug ?? "", params.number ?? "", user)
)
