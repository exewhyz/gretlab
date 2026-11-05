import { route } from "@/lib/api/route"
import { removeMember, updateMember } from "@/features/orgs/server"
import { memberUpdateSchema } from "@/features/orgs/schemas"

export const PATCH = route(
  { access: "user", body: memberUpdateSchema },
  ({ user, params, body }) =>
    updateMember(params.slug ?? "", user, params.userId ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeMember(params.slug ?? "", user, params.userId ?? "")
)
