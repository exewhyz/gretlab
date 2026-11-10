import { route } from "@/lib/api/route"
import { projectMarkSchema } from "@/features/projects/schemas"
import { markProject, studentProjects } from "@/features/projects/work"

/** ?student=email: their projects, for marking. */
export const GET = route({ access: "platform.gradebook.view" }, ({ params, query }) =>
  studentProjects(params.id ?? "", null, "all", query.get("student") ?? "")
)

export const PUT = route({ access: "platform.work.manage", body: projectMarkSchema }, ({ user, params, body }) =>
  markProject(params.id ?? "", null, "all", body, user.id)
)
