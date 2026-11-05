import { route } from "@/lib/api/route"
import { getDaily } from "@/features/catalog/server"

export const GET = route({ access: "public" }, ({ user }) => getDaily(user))
