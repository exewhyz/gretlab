import { route } from "@/lib/api/route"
import { attendanceOverview } from "@/features/attendance/server"

/** Every class this person may see, for one month: days taken, share present, how many below the line. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  attendanceOverview(params.slug ?? "", user, query.get("month") ?? "")
)
