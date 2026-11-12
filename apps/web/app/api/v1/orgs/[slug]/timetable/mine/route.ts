import { route } from "@/lib/api/route"
import { myTeachingWeek } from "@/features/timetable/server"

/** Where I teach each period of the week. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myTeachingWeek(params.slug ?? "", user)
)
