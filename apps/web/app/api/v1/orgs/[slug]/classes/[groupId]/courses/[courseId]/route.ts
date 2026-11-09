import { route } from "@/lib/api/route"
import { removeClassCourse } from "@/features/courses/classes"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeClassCourse(params.slug ?? "", user, params.groupId ?? "", params.courseId ?? "")
)
