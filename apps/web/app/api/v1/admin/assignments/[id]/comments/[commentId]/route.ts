import { route } from "@/lib/api/route"
import { deleteLineComment } from "@/features/assignments/server"

export const DELETE = route({ access: "platform.work.manage" }, ({ params }) =>
  deleteLineComment(params.id ?? "", null, params.commentId ?? "")
)
