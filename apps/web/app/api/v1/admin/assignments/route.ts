import { route } from "@/lib/api/route"
import {
  listAssignmentsForStaff,
  saveAssignment,
} from "@/features/assignments/server"
import { assignmentInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "teacher" }, () =>
  listAssignmentsForStaff(null)
)

export const POST = route(
  { access: "teacher", body: assignmentInputSchema },
  ({ body }) => saveAssignment(null, body, null)
)
