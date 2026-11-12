import { route } from "@/lib/api/route"
import { periodsSchema, savePeriods } from "@/features/timetable/server"

/** Replace the periods and school days. */
export const PUT = route(
  { access: "user", body: periodsSchema },
  ({ user, params, body }) => savePeriods(params.slug ?? "", user, body)
)
