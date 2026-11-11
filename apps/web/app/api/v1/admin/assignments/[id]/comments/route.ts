import { route } from "@/lib/api/route"
import { addLineComment } from "@/features/assignments/server"
import { lineCommentSchema } from "@/features/assignments/feedback-schemas"

/** A comment on one line of a student's submission. */
export const POST = route(
  { access: "platform.work.grade", body: lineCommentSchema },
  ({ user, params, body }) =>
    addLineComment(params.id ?? "", null, "all", body, user.id)
)
