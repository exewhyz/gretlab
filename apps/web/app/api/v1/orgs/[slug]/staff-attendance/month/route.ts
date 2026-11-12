import { route } from "@/lib/api/route"
import { staffMonth } from "@/features/staff-attendance/server"

/** Every staff member's month (?month=YYYY-MM, else this one). */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  staffMonth(params.slug ?? "", user, query.get("month") ?? undefined)
)
