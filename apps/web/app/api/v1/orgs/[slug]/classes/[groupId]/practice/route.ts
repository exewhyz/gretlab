import { route } from "@/lib/api/route"
import { answerPractice } from "@/features/courses/classes"
import { practiceAnswerSchema } from "@/features/courses/schemas"

/** A student's answer to a practice question in one of the class's open course modules. */
export const POST = route({ access: "user", body: practiceAnswerSchema }, ({ user, params, body }) =>
  answerPractice(params.slug ?? "", user, params.groupId ?? "", body.questionId, body.answer)
)
