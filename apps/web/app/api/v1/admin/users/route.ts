import { route } from "@/lib/api/route"
import { listUsers } from "@/features/admin/server"

export const GET = route({ access: "admin" }, ({ query }) =>
  listUsers(query.get("search"))
)
