import { route } from "@/lib/api/route"
import { listAudit } from "@/features/orgs/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  listAudit(params.slug ?? "", user)
)
