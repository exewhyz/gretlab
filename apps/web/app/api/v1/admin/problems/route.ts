import { route } from "@/lib/api/route"
import { problemInputSchema } from "@/features/problems/schemas"
import { listProblemsForStaff, saveProblem } from "@/features/problems/server"

export const GET = route({ access: "teacher" }, ({ query }) =>
  listProblemsForStaff(null, query.get("for") === "picker")
)

export const POST = route(
  { access: "teacher", body: problemInputSchema },
  ({ body }) => saveProblem(null, body, null)
)
