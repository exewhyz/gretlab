import { route } from "@/lib/api/route"
import {
  listAssignmentsForStaff,
  saveAssignment,
} from "@/features/assignments/server"
import { assignmentInputSchema } from "@/features/problems/schemas"

// Reviewers see the list too, to reach gradebooks.
export const GET = route({ access: "platform.gradebook.view" }, () =>
  listAssignmentsForStaff(null)
)

export const POST = route(
  { access: "platform.work.manage", body: assignmentInputSchema },
  ({ body }) => saveAssignment(null, body, null)
)
