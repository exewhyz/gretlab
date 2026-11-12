import { route } from "@/lib/api/route"
import {
  registerSchema,
  saveStaffRegister,
  staffRegister,
} from "@/features/staff-attendance/server"

/** One day's staff register (?day, else today). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  staffRegister(params.slug ?? "", user, query.get("day") ?? undefined)
)

/** Marks staff for a day; those not sent are left as they are. */
export const PUT = route(
  { access: "user", body: registerSchema },
  ({ user, params, body }) => saveStaffRegister(params.slug ?? "", user, body)
)
