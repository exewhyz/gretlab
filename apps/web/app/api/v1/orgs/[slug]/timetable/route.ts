import { route } from "@/lib/api/route"
import { timetableSetup } from "@/features/timetable/server"

/** Periods, school days, and the classes this person may edit. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  timetableSetup(params.slug ?? "", user)
)
