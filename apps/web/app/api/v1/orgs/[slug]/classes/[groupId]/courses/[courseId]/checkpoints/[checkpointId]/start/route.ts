import { startAttempt } from "@/features/courses/checkpoints"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** Starts the student's one attempt at a quiz or lab. */
export const POST = route({ access: "user" }, ({ user, params }) => {
  const [slug, groupId, courseId, checkpointId] = p(params)
  return startAttempt(slug, user, groupId, courseId, checkpointId)
})
