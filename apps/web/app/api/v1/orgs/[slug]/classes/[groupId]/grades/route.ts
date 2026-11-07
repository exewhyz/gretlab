import { route } from "@/lib/api/route"
import { classGrades } from "@/features/classes/server"

/** The class gradebook: every student against every published assignment. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classGrades(params.slug ?? "", user, params.groupId ?? "")
)
