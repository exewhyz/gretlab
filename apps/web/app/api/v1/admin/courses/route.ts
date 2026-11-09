import { route } from "@/lib/api/route"
import { courseSchema } from "@/features/courses/schemas"
import { listCourses, saveCourse } from "@/features/courses/server"
import { writePlatformAudit } from "@/features/platform/staff"

export const GET = route({ access: "platform.library.manage" }, () => listCourses(null))

export const POST = route(
  { access: "platform.library.manage", body: courseSchema },
  async ({ user, body }) => {
    const row = await saveCourse(null, null, body)
    await writePlatformAudit(user, "course.create", `Created the course ${row.title}`)
    return row
  }
)
