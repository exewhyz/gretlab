import { route } from "@/lib/api/route"
import { getProgress } from "@/features/submissions/server"

export const GET = route({ access: "user" }, ({ user }) => getProgress(user))
