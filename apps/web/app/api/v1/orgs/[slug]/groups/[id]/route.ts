import { route } from "@/lib/api/route"
import { deleteGroup, updateGroup } from "@/features/orgs/server"
import { groupSchema } from "@/features/orgs/schemas"

export const PATCH = route(
  { access: "user", body: groupSchema.pick({ name: true, description: true }) },
  ({ user, params, body }) =>
    updateGroup(params.slug ?? "", user, params.id ?? "", body)
)

/** ?force=true deletes a group that has people, taking them out of it. */
export const DELETE = route({ access: "user" }, ({ user, params, query }) =>
  deleteGroup(
    params.slug ?? "",
    user,
    params.id ?? "",
    query.get("force") === "true"
  )
)
