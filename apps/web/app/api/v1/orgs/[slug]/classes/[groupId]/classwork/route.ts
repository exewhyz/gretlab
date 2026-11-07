import { route } from "@/lib/api/route"
import { classwork } from "@/features/classes/server"

/** Assignments and contests reaching this class, and its syllabus. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classwork(params.slug ?? "", user, params.groupId ?? "")
)
