import { route } from "@/lib/api/route"
import { addClassCourse, classCourses } from "@/features/courses/classes"
import { classCourseSchema } from "@/features/courses/schemas"

/** The class's courses: the outline as it opens for this person, and progress for teachers. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classCourses(params.slug ?? "", user, params.groupId ?? "")
)

export const POST = route({ access: "user", body: classCourseSchema }, ({ user, params, body }) =>
  addClassCourse(params.slug ?? "", user, params.groupId ?? "", body)
)
