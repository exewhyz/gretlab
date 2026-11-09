import { route } from "@/lib/api/route"
import { saveQuizAnswers } from "@/features/assignments/server"
import { quizAnswersSchema } from "@/features/assignments/feedback-schemas"

/** Your answers to the quiz questions, saved as you type until your time is up. */
export const PUT = route(
  { access: "user", body: quizAnswersSchema },
  ({ user, params, body }) => saveQuizAnswers(params.slug ?? "", user, body.answers)
)
