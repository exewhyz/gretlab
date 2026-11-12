import { route } from "@/lib/api/route"
import { checkIn } from "@/features/staff-attendance/server"

/** Checks yourself in for today. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  checkIn(params.slug ?? "", user)
)
