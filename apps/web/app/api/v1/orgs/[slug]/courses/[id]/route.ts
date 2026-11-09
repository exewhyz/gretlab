import { route } from "@/lib/api/route"
import { orgCourse, orgDeleteCourse, orgSaveCourse } from "@/features/courses/org"
import { courseSchema } from "@/features/courses/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgCourse(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route({ access: "user", body: courseSchema }, ({ user, params, body }) =>
  orgSaveCourse(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  orgDeleteCourse(params.slug ?? "", user, params.id ?? "")
)
