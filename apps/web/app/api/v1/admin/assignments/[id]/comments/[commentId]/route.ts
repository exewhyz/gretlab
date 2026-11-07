import { route } from "@/lib/api/route"
import { deleteLineComment } from "@/features/assignments/server"

export const DELETE = route({ access: "teacher" }, ({ params }) =>
  deleteLineComment(params.id ?? "", null, params.commentId ?? "")
)
