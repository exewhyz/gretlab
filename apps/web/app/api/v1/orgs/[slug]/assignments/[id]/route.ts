import { route } from "@/lib/api/route"
import {
  deleteOrgAssignment,
  orgAssignment,
  saveOrgAssignment,
} from "@/features/orgs/content"
import { assignmentInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgAssignment(params.slug ?? "", user, params.id ?? "")
)

export const PUT = route(
  { access: "user", body: assignmentInputSchema },
  ({ user, params, body }) =>
    saveOrgAssignment(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteOrgAssignment(params.slug ?? "", user, params.id ?? "")
)
