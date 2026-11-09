import { route } from "@/lib/api/route"
import { setRubricMarks } from "@/features/assignments/server"
import { rubricMarksSchema } from "@/features/assignments/feedback-schemas"

/** A teacher's rubric marks for one student on one problem. */
export const PUT = route(
  { access: "platform.work.manage", body: rubricMarksSchema },
  ({ user, params, body }) =>
    setRubricMarks(params.id ?? "", null, "all", body, user.id)
)
