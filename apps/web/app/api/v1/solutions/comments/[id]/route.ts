import { route } from "@/lib/api/route"
import { deleteComment } from "@/features/solutions/server"

/** Deletes your own comment. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteComment(params.id ?? "", user)
)
