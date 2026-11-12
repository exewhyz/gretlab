import { route } from "@/lib/api/route"
import { classTimetable } from "@/features/timetable/server"

/** A class's weekly timetable. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classTimetable(params.slug ?? "", user, params.groupId ?? "")
)
