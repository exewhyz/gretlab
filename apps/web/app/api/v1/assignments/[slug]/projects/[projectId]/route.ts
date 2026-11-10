import { route } from "@/lib/api/route"
import { projectSubmitSchema } from "@/features/projects/schemas"
import { submitProject } from "@/features/projects/work"

/** Hands in a GitHub repository for the project, pinned to its current commit. */
export const POST = route({ access: "user", body: projectSubmitSchema }, ({ user, params, body }) =>
  submitProject(params.slug ?? "", user, params.projectId ?? "", body)
)
