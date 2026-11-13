import { route } from "@/lib/api/route"
import { removeClassCourse } from "@/features/courses/classes"
import { trainingDetail } from "@/features/training/server"

/** Each person a training reaches, and where they are with it. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  trainingDetail(params.slug ?? "", user, params.groupId ?? "", params.courseId ?? "")
)

/** Takes the training off the group (people's work stays). */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeClassCourse(params.slug ?? "", user, params.groupId ?? "", params.courseId ?? "")
)
