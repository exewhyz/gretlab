import { route } from "@/lib/api/route"
import {
  deleteAssignment,
  getAssignmentForStaff,
  saveAssignment,
} from "@/features/assignments/server"
import { assignmentInputSchema } from "@/features/problems/schemas"

export const GET = route({ access: "platform.work.manage" }, ({ params }) =>
  getAssignmentForStaff(params.id ?? "", null)
)

export const PUT = route(
  { access: "platform.work.manage", body: assignmentInputSchema },
  ({ params, body }) => saveAssignment(params.id ?? "", body, null)
)

export const DELETE = route({ access: "platform.work.manage" }, ({ params }) =>
  deleteAssignment(params.id ?? "", null)
)
