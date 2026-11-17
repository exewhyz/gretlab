import { markProject } from "@/features/courses/checkpoints"
import { projectMarkSchema } from "@/features/courses/schemas"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** A teacher's mark and feedback on a student's project. */
export const PUT = route(
  { access: "user", body: projectMarkSchema },
  ({ user, params, body }) => {
    const [slug, groupId, courseId, checkpointId] = p(params)
    return markProject(
      slug,
      user,
      groupId,
      courseId,
      checkpointId,
      params.studentId ?? "",
      body
    )
  }
)
