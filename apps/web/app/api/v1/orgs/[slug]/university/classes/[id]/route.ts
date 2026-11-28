import { route } from "@/lib/api/route"
import { unmapClass } from "@/features/university/syllabus"

/** The class stops following the university's semester; its courses stay. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  unmapClass(params.slug ?? "", user, params.id ?? "")
)
