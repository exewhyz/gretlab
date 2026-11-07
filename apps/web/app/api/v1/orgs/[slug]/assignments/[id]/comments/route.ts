import { route } from "@/lib/api/route"
import { orgAddLineComment } from "@/features/orgs/content"
import { lineCommentSchema } from "@/features/assignments/feedback-schemas"

/** A comment on one line of a student's submission. */
export const POST = route(
  { access: "user", body: lineCommentSchema },
  ({ user, params, body }) =>
    orgAddLineComment(params.slug ?? "", user, params.id ?? "", body)
)
