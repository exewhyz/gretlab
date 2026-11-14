import { route } from "@/lib/api/route"
import { problemInputSchema } from "@/features/problems/schemas"
import { listProblemsForStaff, saveProblem } from "@/features/problems/server"

// Writers and editors read the bank; those who set work pick from it; reviewers of
// submissions choose a problem to check for copying.
export const GET = route({ access: ["platform.library.create", "platform.library.edit", "platform.work.create", "platform.work.edit", "platform.submissions.view"] }, ({ user, query }) =>
  listProblemsForStaff(null, query.get("for") === "picker", user.id)
)

export const POST = route(
  { access: "platform.library.create", body: problemInputSchema },
  ({ body }) => saveProblem(null, body, null)
)
