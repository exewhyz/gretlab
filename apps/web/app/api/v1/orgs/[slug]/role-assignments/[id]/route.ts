import { route } from "@/lib/api/route"
import { unassignRole } from "@/features/orgs/server"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  unassignRole(params.slug ?? "", user, params.id ?? "")
)
