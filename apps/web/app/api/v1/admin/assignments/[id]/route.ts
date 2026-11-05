import { route } from "@/lib/api/route"
import {
  deleteAssignment,
  getAssignmentForStaff,
  saveAssignment,
} from "@/features/assignments/server"
import { assignmentInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "teacher" }, ({ params }) =>
  getAssignmentForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "teacher", body: assignmentInputSchema },
  ({ params, body }) => saveAssignment(params.id ?? "", body, null)
)

export const DELETE = route({ access: "teacher" }, ({ params }) =>
  deleteAssignment(params.id ?? "", null)
)
