import { route } from "@/lib/api/route"
import { getManageSummary } from "@/features/orgs/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  getManageSummary(params.slug ?? "", user)
)
