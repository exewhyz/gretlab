import { platformCan } from "@/features/platform/access"
import { route } from "@/lib/api/route"
import {
  listAssignmentsForStaff,
  saveAssignment,
} from "@/features/assignments/server"
import { assignmentInputSchema } from "@/features/problems/schemas"

// Reviewers see the list too, to reach gradebooks.
export const GET = route({ access: "platform.gradebook.view" }, async ({ user }) => {
  const canEdit = await platformCan(user, "platform.work.edit")
  return (await listAssignmentsForStaff(null)).map((a) => ({ ...a, canEdit }))
})

export const POST = route(
  { access: "platform.work.create", body: assignmentInputSchema },
  ({ body }) => saveAssignment(null, body, null)
)
