import { route } from "@/lib/api/route"
import { extendStudentSitting } from "@/features/assignments/server"
import { extendSchema } from "@/features/assignments/feedback-schemas"

/** More exam time for one student. */
export const POST = route(
  { access: "platform.work.manage", body: extendSchema },
  ({ params, body }) => extendStudentSitting(params.id ?? "", null, "all", body)
)
