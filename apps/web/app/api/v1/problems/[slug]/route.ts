import { ApiError, notFound, route } from "@/lib/api/route"
import { examScope } from "@/features/exams/server"
import { getPublicProblem } from "@/features/problems/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user, params }) => {
  await requireFeature("practice.enabled")
  const problem = await getPublicProblem(params.slug ?? "")
  if (!problem) throw notFound("Problem not found")
  // During an exam, the library is closed; the exam's own pages serve its problems.
  if (user && (await examScope(user.id))) {
    throw new ApiError(403, "exam_locked", "The problem library is closed during your exam.")
  }
  return problem
})
