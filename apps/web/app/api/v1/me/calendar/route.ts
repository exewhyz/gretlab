import { route } from "@/lib/api/route"
import { myCalendar } from "@/features/calendar/server"

/** Everything with a date for the viewer, and their feed's secret if it's on. */
export const GET = route({ access: "user" }, ({ user }) => myCalendar(user))
