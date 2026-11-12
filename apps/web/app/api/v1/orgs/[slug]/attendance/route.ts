import { route } from "@/lib/api/route"
import { attendanceGroups } from "@/features/attendance/server"

/** Groups this person may take or see attendance for, and today's date. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  attendanceGroups(params.slug ?? "", user)
)
