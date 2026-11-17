import { resetAttempt } from "@/features/courses/checkpoints"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** Lets a student take a quiz or lab again. */
export const DELETE = route({ access: "user" }, ({ user, params }) => {
  const [slug, groupId, courseId, checkpointId] = p(params)
  return resetAttempt(
    slug,
    user,
    groupId,
    courseId,
    checkpointId,
    params.studentId ?? ""
  )
})
