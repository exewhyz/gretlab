import { route } from "@/lib/api/route"
import { myAttendance } from "@/features/staff-attendance/server"

/** Your own attendance: today and the month (?month). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  myAttendance(params.slug ?? "", user, query.get("month") ?? undefined)
)
