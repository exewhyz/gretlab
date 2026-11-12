import { route } from "@/lib/api/route"
import { searchStudents } from "@/features/parents/server"

/** Students this person may link parents to, matching ?q=. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  searchStudents(params.slug ?? "", user, query.get("q") ?? "")
)
