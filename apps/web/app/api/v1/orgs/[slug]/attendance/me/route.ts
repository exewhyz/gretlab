import { route } from "@/lib/api/route"
import { myCourseAttendance } from "@/features/attendance/server"

/** Your own attendance by course this term, and how far from the minimum to sit exams. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myCourseAttendance(params.slug ?? "", user)
)
