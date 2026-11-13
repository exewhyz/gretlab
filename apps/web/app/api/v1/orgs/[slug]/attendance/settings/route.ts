import { route } from "@/lib/api/route"
import {
  attendanceSettings,
  attendanceSettingsSchema,
  saveAttendanceSettings,
} from "@/features/attendance/server"

/** The minimum attendance to sit exams. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  attendanceSettings(params.slug ?? "", user)
)

export const PUT = route(
  { access: "user", body: attendanceSettingsSchema },
  ({ user, params, body }) => saveAttendanceSettings(params.slug ?? "", user, body)
)
