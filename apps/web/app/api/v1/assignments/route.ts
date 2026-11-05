import { route } from "@/lib/api/route"
import { listAssignments } from "@/features/assignments/server"

export const GET = route({ access: "user" }, ({ user }) =>
  listAssignments(user)
)
