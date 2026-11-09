import { route } from "@/lib/api/route"
import { orgCopyCourse } from "@/features/courses/org"

/** A college's own copy of a course shared with it. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgCopyCourse(params.slug ?? "", user, params.id ?? "")
)
