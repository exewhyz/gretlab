import { route } from "@/lib/api/route"
import { quizMarksSchema } from "@/features/assignments/feedback-schemas"
import { orgSetQuizMarks, orgStudentQuiz } from "@/features/orgs/content"

/** ?student=email: their answers with the automatic marks. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  orgStudentQuiz(params.slug ?? "", user, params.id ?? "", query.get("student") ?? "")
)

/** Marks that replace the automatic ones (null goes back to automatic). */
export const PUT = route(
  { access: "user", body: quizMarksSchema },
  ({ user, params, body }) =>
    orgSetQuizMarks(params.slug ?? "", user, params.id ?? "", body)
)
