import { route } from "@/lib/api/route"
import { listUsers } from "@/features/admin/server"

export const GET = route({ access: "platform.users.manage" }, ({ query }) =>
  listUsers(query.get("search"))
)
