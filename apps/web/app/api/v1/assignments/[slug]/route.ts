import { route } from "@/lib/api/route"
import { getAssignment } from "@/features/assignments/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  getAssignment(params.slug ?? "", user)
)
