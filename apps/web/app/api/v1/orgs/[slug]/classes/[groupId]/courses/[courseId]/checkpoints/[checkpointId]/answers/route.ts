import { saveQuizAnswers } from "@/features/courses/checkpoints"
import { quizAnswersSchema } from "@/features/courses/schemas"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** Saves a quiz's answers while the attempt is going. */
export const PUT = route(
  { access: "user", body: quizAnswersSchema },
  ({ user, params, body }) => {
    const [slug, groupId, courseId, checkpointId] = p(params)
    return saveQuizAnswers(
      slug,
      user,
      groupId,
      courseId,
      checkpointId,
      body.answers
    )
  }
)
