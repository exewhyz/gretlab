import { route } from "@/lib/api/route"
import { examEventSchema } from "@/features/assignments/feedback-schemas"
import { recordExamEvent } from "@/features/exams/server"

/** Something the browser noticed during a sitting: leaving the tab or fullscreen, pasting. */
export const POST = route(
  { access: "user", body: examEventSchema },
  ({ user, params, body }) =>
    recordExamEvent(params.slug ?? "", user, body.kind, body.detail)
)
