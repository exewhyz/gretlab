import { route } from "@/lib/api/route"
import { emptyGroup } from "@/features/orgs/server"

/** Takes everyone out of the group and the groups inside it. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  emptyGroup(params.slug ?? "", user, params.id ?? "")
)
