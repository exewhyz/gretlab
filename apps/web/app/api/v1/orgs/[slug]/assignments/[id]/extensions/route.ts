import { route } from "@/lib/api/route"
import { extensionSchema } from "@/features/assignments/feedback-schemas"
import { orgRemoveExtension, orgSetExtension } from "@/features/orgs/content"

/** A later due date for one student (all problems, or reopening some). */
export const PUT = route(
  { access: "user", body: extensionSchema },
  ({ user, params, body }) =>
    orgSetExtension(params.slug ?? "", user, params.id ?? "", body)
)

/** ?student=email: back to the assignment's own due time. */
export const DELETE = route({ access: "user" }, ({ user, params, query }) =>
  orgRemoveExtension(params.slug ?? "", user, params.id ?? "", query.get("student") ?? "")
)
