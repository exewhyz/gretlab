import { route } from "@/lib/api/route"
import { orgSetRubricMarks } from "@/features/orgs/content"
import { rubricMarksSchema } from "@/features/assignments/feedback-schemas"

/** A teacher's rubric marks for one student on one problem. */
export const PUT = route(
  { access: "user", body: rubricMarksSchema },
  ({ user, params, body }) =>
    orgSetRubricMarks(params.slug ?? "", user, params.id ?? "", body)
)
