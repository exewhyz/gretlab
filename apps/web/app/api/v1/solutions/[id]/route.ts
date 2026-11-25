import { route } from "@/lib/api/route"
import { deletePost, getPost } from "@/features/solutions/server"

/** One solution post with its code and comments. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getPost(params.id ?? "", user)
)

/** Deletes your own post. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deletePost(params.id ?? "", user)
)
