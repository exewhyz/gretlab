import { route } from "@/lib/api/route"
import { revokeInvite } from "@/features/orgs/server"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  revokeInvite(params.slug ?? "", user, params.id ?? "")
)
