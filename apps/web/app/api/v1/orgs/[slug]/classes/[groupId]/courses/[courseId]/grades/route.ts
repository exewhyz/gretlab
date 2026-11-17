import { courseGrades } from "@/features/courses/checkpoints"
import { route } from "@/lib/api/route"

/** The class's grade sheet for a course's quizzes, labs and projects (teachers). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  courseGrades(
    params.slug ?? "",
    user,
    params.groupId ?? "",
    params.courseId ?? ""
  )
)
