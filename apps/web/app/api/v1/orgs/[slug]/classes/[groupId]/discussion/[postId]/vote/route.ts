import { route } from "@/lib/api/route"
import { toggleVote } from "@/features/discussions/server"

export const POST = route({ access: "user" }, ({ user, params }) =>
  toggleVote(params.slug ?? "", user, params.groupId ?? "", params.postId ?? "")
)
