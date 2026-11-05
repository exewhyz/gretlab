import { route } from "@/lib/api/route"
import { deleteNote } from "@/features/problems/server"

export const DELETE = route({ access: "teacher" }, ({ params }) =>
  deleteNote(params.id ?? "", null)
)
