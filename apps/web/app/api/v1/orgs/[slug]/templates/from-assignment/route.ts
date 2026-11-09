import { route } from "@/lib/api/route"
import { orgTemplateFromAssignment } from "@/features/templates/org"
import { fromAssignmentSchema } from "@/features/templates/schemas"

export const POST = route({ access: "user", body: fromAssignmentSchema }, ({ user, params, body }) =>
  orgTemplateFromAssignment(params.slug ?? "", user, body.assignmentId)
)
