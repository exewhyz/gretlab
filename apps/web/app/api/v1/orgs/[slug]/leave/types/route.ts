import { route } from "@/lib/api/route"
import { leaveTypes, saveLeaveTypes, typesSchema } from "@/features/leave/server"

/** The kinds of staff leave and days a year each. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  leaveTypes(params.slug ?? "", user)
)

export const PUT = route(
  { access: "user", body: typesSchema },
  ({ user, params, body }) => saveLeaveTypes(params.slug ?? "", user, body)
)
