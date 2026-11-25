import { route } from "@/lib/api/route"
import { reportPost } from "@/features/solutions/server"

/** Reports a post to the moderators, once. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  reportPost(params.id ?? "", user)
)
