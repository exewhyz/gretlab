import { route } from "@/lib/api/route"
import { orgAssignments, saveOrgAssignment } from "@/features/orgs/content"
import { assignmentInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgAssignments(params.slug ?? "", user)
)

export const POST = route(
  { access: "user", body: assignmentInputSchema },
  ({ user, params, body }) =>
    saveOrgAssignment(params.slug ?? "", user, null, body)
)
