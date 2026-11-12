import { route } from "@/lib/api/route"
import {
  saveStaffSettings,
  settingsSchema,
} from "@/features/staff-attendance/server"

/** The late time and whether staff may check themselves in. */
export const PUT = route(
  { access: "user", body: settingsSchema },
  ({ user, params, body }) => saveStaffSettings(params.slug ?? "", user, body)
)
