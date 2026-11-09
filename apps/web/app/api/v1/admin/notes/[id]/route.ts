import { route } from "@/lib/api/route"
import { deleteNote } from "@/features/problems/server"

export const DELETE = route({ access: "platform.library.manage" }, ({ params }) =>
  deleteNote(params.id ?? "", null)
)
