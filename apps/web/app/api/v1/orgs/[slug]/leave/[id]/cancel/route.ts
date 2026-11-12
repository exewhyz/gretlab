import { route } from "@/lib/api/route"
import { cancelLeave } from "@/features/leave/server"

/** Takes back a waiting request, or approved leave that hasn't started. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  cancelLeave(params.slug ?? "", user, params.id ?? "")
)
