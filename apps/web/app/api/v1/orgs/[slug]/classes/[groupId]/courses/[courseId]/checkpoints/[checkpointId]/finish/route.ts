import { finishAttempt } from "@/features/courses/checkpoints"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** Ends the student's attempt early. */
export const POST = route({ access: "user" }, ({ user, params }) => {
  const [slug, groupId, courseId, checkpointId] = p(params)
  return finishAttempt(slug, user, groupId, courseId, checkpointId)
})
