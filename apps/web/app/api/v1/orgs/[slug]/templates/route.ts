import { route } from "@/lib/api/route"
import { assignmentInputSchema } from "@/features/problems/schemas"
import { orgSaveTemplate, orgTemplates } from "@/features/templates/org"

export const GET = route({ access: "user" }, ({ user, params }) => orgTemplates(params.slug ?? "", user))

/** A new template, saved with the assignment form's body (dates, address and audience ignored). */
export const POST = route({ access: "user", body: assignmentInputSchema }, ({ user, params, body }) =>
  orgSaveTemplate(params.slug ?? "", user, null, body)
)
