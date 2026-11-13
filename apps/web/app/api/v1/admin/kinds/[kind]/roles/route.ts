import { route } from "@/lib/api/route"
import { kindRolesSchema, saveKindRoles } from "@/features/orgs/kinds"

/** Sets a kind's suggested roles (the whole list), or { roles: null } for the default. */
export const PUT = route({ access: "user", body: kindRolesSchema }, ({ user, params, body }) =>
  saveKindRoles(user, params.kind ?? "", body)
)
