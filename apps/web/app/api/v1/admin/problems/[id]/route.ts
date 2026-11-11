import { route } from "@/lib/api/route"
import { problemInputSchema } from "@/features/problems/schemas"
import {
  deleteProblem,
  getProblemForStaff,
  saveProblem,
} from "@/features/problems/server"

export const GET = route({ access: "platform.library.manage" }, ({ params }) =>
  getProblemForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "platform.library.edit", body: problemInputSchema },
  ({ params, body }) => saveProblem(params.id ?? "", body, null)
)

export const DELETE = route({ access: "platform.library.delete" }, ({ params }) =>
  deleteProblem(params.id ?? "", null)
)
