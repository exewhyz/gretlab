import { route } from "@/lib/api/route"
import { subjectTeachers } from "@/features/subjects/server"

/** Who can be chosen to teach a subject in a class. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  subjectTeachers(params.slug ?? "", user, query.get("groupId") ?? "")
)
