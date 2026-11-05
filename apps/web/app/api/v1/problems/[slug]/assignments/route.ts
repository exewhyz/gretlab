import { route } from "@/lib/api/route"
import { assignmentsForProblem } from "@/features/assignments/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  assignmentsForProblem(params.slug ?? "", user)
)
