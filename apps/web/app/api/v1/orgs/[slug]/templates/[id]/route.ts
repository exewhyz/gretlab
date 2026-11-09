import { route } from "@/lib/api/route"
import { assignmentInputSchema } from "@/features/problems/schemas"
import { orgDeleteTemplate, orgSaveTemplate, orgTemplate } from "@/features/templates/org"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgTemplate(params.slug ?? "", user, params.id ?? "")
)

/** Saves it and brings the changes to its uses that haven't opened. */
export const PUT = route({ access: "user", body: assignmentInputSchema }, ({ user, params, body }) =>
  orgSaveTemplate(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  orgDeleteTemplate(params.slug ?? "", user, params.id ?? "")
)
