import { getDb, sql, submissions } from "@workspace/db"

import { ApiError, isStaff, notFound, route } from "@/lib/api/route"
import { canEditProblem, canReachProblem } from "@/features/submissions/server"
import {
  getProblemBySlug,
  isInLiveContest,
  referenceSolutions,
} from "@/features/problems/server"
import { requireFeature } from "@/features/settings/server"
import { guardExamSolutions } from "@/features/exams/server"

/** The editorial and reference solutions, once the student is allowed to see them. */
export const GET = route({ access: "user" }, async ({ user, params }) => {
  const problem = await getProblemBySlug(params.slug ?? "")
  // Its writers, and platform staff, see solutions without the student rules.
  const writer =
    problem !== null && (isStaff(user) || (await canEditProblem(user, problem)))
  if (!problem || (!writer && !(await canReachProblem(user, problem)))) {
    throw notFound("Problem not found")
  }
  if (!writer) {
    const settings = await requireFeature("practice.show_solutions")
    await guardExamSolutions(user.id)
    if (await isInLiveContest(problem.id)) {
      throw new ApiError(
        403,
        "contest_running",
        "Hidden while a contest uses this problem."
      )
    }
    if (settings["practice.solutions_after_solve"]) {
      const [solved] = await getDb()
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          sql.and(
            sql.eq(submissions.userId, user.id),
            sql.eq(submissions.problemId, problem.id),
            sql.eq(submissions.kind, "submit"),
            sql.eq(submissions.verdict, "AC")
          )
        )
        .limit(1)
      if (!solved) {
        throw new ApiError(
          403,
          "solve_first",
          "Solve this problem first to unlock its editorial."
        )
      }
    }
  }
  return {
    editorial: problem.editorial,
    /** One per language that has a reference solution. */
    solutions: referenceSolutions(problem),
    /** The Python one, for older clients. */
    solution: problem.solution,
  }
})
