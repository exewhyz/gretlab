import { route } from "@/lib/api/route"
import { attendanceMonth } from "@/features/attendance/server"

/** A group's attendance for a month: one column per register or marked class. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  attendanceMonth(
    params.slug ?? "",
    user,
    query.get("groupId") ?? "",
    query.get("month") ?? ""
  )
)
