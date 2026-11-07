import { route } from "@/lib/api/route"
import { classAttendance } from "@/features/classes/server"

/** Attendance over logged classes: everyone's for teachers, your own for students. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classAttendance(params.slug ?? "", user, params.groupId ?? "")
)
