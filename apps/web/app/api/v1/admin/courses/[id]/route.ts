import { route } from "@/lib/api/route"
import { courseSchema } from "@/features/courses/schemas"
import { deleteCourse, getCourse, saveCourse } from "@/features/courses/server"
import { writePlatformAudit } from "@/features/platform/staff"

export const GET = route({ access: "platform.library.manage" }, ({ params }) =>
  getCourse(null, params.id ?? "")
)

export const PUT = route(
  { access: "platform.library.manage", body: courseSchema },
  ({ params, body }) => saveCourse(null, params.id ?? "", body)
)

export const DELETE = route({ access: "platform.library.manage" }, async ({ user, params }) => {
  const course = await getCourse(null, params.id ?? "")
  await deleteCourse(null, course.id)
  await writePlatformAudit(user, "course.delete", `Deleted the course ${course.title}`)
})
