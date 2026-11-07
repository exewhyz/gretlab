import { route } from "@/lib/api/route"
import { orgDeleteLineComment } from "@/features/orgs/content"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  orgDeleteLineComment(
    params.slug ?? "",
    user,
    params.id ?? "",
    params.commentId ?? ""
  )
)
