import { route } from "@/lib/api/route"
import { orgMarkProject, orgStudentProjects } from "@/features/projects/org"
import { projectMarkSchema } from "@/features/projects/schemas"

/** ?student=email: their projects, for marking. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  orgStudentProjects(params.slug ?? "", user, params.id ?? "", query.get("student") ?? "")
)

export const PUT = route({ access: "user", body: projectMarkSchema }, ({ user, params, body }) =>
  orgMarkProject(params.slug ?? "", user, params.id ?? "", body)
)
