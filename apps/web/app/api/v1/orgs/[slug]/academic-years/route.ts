import { route } from "@/lib/api/route"
import { addYear, listYears, yearSchema } from "@/features/records/server"

/** The organization's academic years, newest first, with how many are enrolled in each. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  listYears(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: yearSchema },
  ({ user, params, body }) => addYear(params.slug ?? "", user, body)
)
