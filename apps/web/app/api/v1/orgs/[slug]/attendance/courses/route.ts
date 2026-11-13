import { z } from "zod"

import { ApiError, route } from "@/lib/api/route"
import { courseAttendance } from "@/features/attendance/server"

/** ?groupId: each student's attendance by course this term, and who's short of the minimum. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const groupId = z.uuid().safeParse(query.get("groupId")).data
  if (!groupId) throw new ApiError(400, "bad_filter", "Choose a class.")
  return courseAttendance(params.slug ?? "", user, groupId)
})
