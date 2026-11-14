import { route } from "@/lib/api/route"
import {
  addHoliday,
  holidaySchema,
  listHolidays,
} from "@/features/holidays/server"

/** The days this organization is closed. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  listHolidays(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: holidaySchema },
  ({ user, params, body }) => addHoliday(params.slug ?? "", user, body)
)
