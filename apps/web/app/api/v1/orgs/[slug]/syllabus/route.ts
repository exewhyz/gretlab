import { route } from "@/lib/api/route"
import { universitySyllabus } from "@/features/university/syllabus"

/** A university's common syllabus: its programs, courses, and each semester's. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  universitySyllabus(params.slug ?? "", user)
)
