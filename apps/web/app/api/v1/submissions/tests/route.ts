import { route } from "@/lib/api/route"
import { browserTests } from "@/features/submissions/server"
import { ApiError } from "@/lib/api/errors"

/** Every test's input, for a Submit graded in the browser. Only where that's allowed. */
export const GET = route({ access: "user" }, ({ user, query }) => {
  const problemSlug = query.get("problem")
  if (!problemSlug) throw new ApiError(400, "problem_required", "Choose a problem.")
  return browserTests(user, {
    problemSlug,
    contestSlug: query.get("contest") ?? undefined,
    assignmentSlug: query.get("assignment") ?? undefined,
  })
})
