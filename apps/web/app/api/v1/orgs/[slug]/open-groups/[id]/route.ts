import { route } from "@/lib/api/route"
import { joinOpenGroup } from "@/features/orgs/server"

/** Joins an open group. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  joinOpenGroup(params.slug ?? "", user, params.id ?? "", true)
)

/** Leaves it. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  joinOpenGroup(params.slug ?? "", user, params.id ?? "", false)
)
