import { route } from "@/lib/api/route"
import { removeExtension, setExtension } from "@/features/assignments/server"
import { extensionSchema } from "@/features/assignments/feedback-schemas"

/** A later due date for one student (all problems, or reopening some). */
export const PUT = route(
  { access: "platform.work.manage", body: extensionSchema },
  ({ user, params, body }) => setExtension(params.id ?? "", null, "all", body, user.id)
)

/** ?student=email: back to the assignment's own due time. */
export const DELETE = route({ access: "platform.work.manage" }, ({ params, query }) =>
  removeExtension(params.id ?? "", null, "all", query.get("student") ?? "")
)
