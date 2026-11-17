import { checkpointView } from "@/features/courses/checkpoints"
import { route } from "@/lib/api/route"

const p = (params: Record<string, string | undefined>) =>
  [
    params.slug ?? "",
    params.groupId ?? "",
    params.courseId ?? "",
    params.checkpointId ?? "",
  ] as const

/** A module's quiz, lab or project, and where the viewer stands on it. */
export const GET = route({ access: "user" }, ({ user, params }) => {
  const [slug, groupId, courseId, checkpointId] = p(params)
  return checkpointView(slug, user, groupId, courseId, checkpointId)
})
