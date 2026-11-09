import { route } from "@/lib/api/route"
import { fromAssignmentSchema } from "@/features/templates/schemas"
import { templateFromAssignment } from "@/features/templates/server"

export const POST = route(
  { access: "platform.work.manage", body: fromAssignmentSchema },
  ({ body }) => templateFromAssignment(null, body.assignmentId)
)
