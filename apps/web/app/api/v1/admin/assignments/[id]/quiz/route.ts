import { route } from "@/lib/api/route"
import { setQuizMarks, studentQuiz } from "@/features/assignments/server"
import { quizMarksSchema } from "@/features/assignments/feedback-schemas"

/** ?student=email: their answers with the automatic marks. */
export const GET = route({ access: "teacher" }, ({ params, query }) =>
  studentQuiz(params.id ?? "", null, "all", query.get("student") ?? "")
)

/** Marks that replace the automatic ones (null goes back to automatic). */
export const PUT = route(
  { access: "teacher", body: quizMarksSchema },
  ({ params, body }) => setQuizMarks(params.id ?? "", null, "all", body)
)
