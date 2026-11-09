import { route } from "@/lib/api/route"
import { orgCourses, orgSaveCourse } from "@/features/courses/org"
import { courseSchema } from "@/features/courses/schemas"

export const GET = route({ access: "user" }, ({ user, params }) => orgCourses(params.slug ?? "", user))

export const POST = route({ access: "user", body: courseSchema }, ({ user, params, body }) =>
  orgSaveCourse(params.slug ?? "", user, null, body)
)
