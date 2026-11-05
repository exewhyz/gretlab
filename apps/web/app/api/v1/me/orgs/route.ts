import { route } from "@/lib/api/route"
import { myOrganizations } from "@/features/orgs/server"

export const GET = route({ access: "user" }, ({ user }) =>
  myOrganizations(user)
)
