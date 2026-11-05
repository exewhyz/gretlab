import { route } from "@/lib/api/route"
import { orgProblems, saveOrgProblem } from "@/features/orgs/content"
import { problemInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "user" }, ({ user, params, query }) =>
  orgProblems(params.slug ?? "", user, query.get("for") === "picker")
)

export const POST = route(
  { access: "user", body: problemInputSchema },
  ({ user, params, body }) =>
    saveOrgProblem(params.slug ?? "", user, null, body)
)
