import { route } from "@/lib/api/route"
import { removeFromGroup } from "@/features/orgs/server"

/** Takes one person out of the group and the groups inside it. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeFromGroup(params.slug ?? "", user, params.id ?? "", [
    params.userId ?? "",
  ])
)
