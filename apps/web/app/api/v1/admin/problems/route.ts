import { route } from "@/lib/api/route"
import { problemInputSchema } from "@/features/problems/schemas"
import { listProblemsForStaff, saveProblem } from "@/features/problems/server"

export const GET = route({ access: "platform.library.manage" }, ({ user, query }) =>
  listProblemsForStaff(null, query.get("for") === "picker", user.id)
)

export const POST = route(
  { access: "platform.library.manage", body: problemInputSchema },
  ({ body }) => saveProblem(null, body, null)
)
