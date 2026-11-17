import { handInProject } from "@/features/courses/checkpoints"
import { projectHandInSchema } from "@/features/courses/schemas"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** Hands in (or replaces) the student's project repository. */
export const POST = route(
  { access: "user", body: projectHandInSchema },
  ({ user, params, body }) => {
    const [slug, groupId, courseId, checkpointId] = p(params)
    return handInProject(slug, user, groupId, courseId, checkpointId, body)
  }
)
