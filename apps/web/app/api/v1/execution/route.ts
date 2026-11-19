import { route } from "@/lib/api/route"
import { executionFor } from "@/features/submissions/execution"

/** Where Run and Submit go for a problem in its context (practice, assignment, contest). */
export const GET = route({ access: "public" }, ({ user, query }) =>
  executionFor(user ?? null, {
    problem: query.get("problem"),
    contest: query.get("contest"),
    assignment: query.get("assignment"),
  })
)
