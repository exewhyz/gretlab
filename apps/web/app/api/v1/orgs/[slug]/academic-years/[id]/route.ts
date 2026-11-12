import { route } from "@/lib/api/route"
import { deleteYear, updateYear, yearSchema } from "@/features/records/server"

/** Change a year; `isCurrent: true` makes it current, moving every student to their place in it. */
export const PATCH = route(
  { access: "user", body: yearSchema.partial() },
  ({ user, params, body }) =>
    updateYear(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteYear(params.slug ?? "", user, params.id ?? "")
)
