import { route } from "@/lib/api/route"
import { assignSchema, assignSubject } from "@/features/subjects/server"

/** Put this subject on a class, or change who teaches it there. */
export const POST = route(
  { access: "user", body: assignSchema },
  ({ user, params, body }) =>
    assignSubject(params.slug ?? "", user, params.id ?? "", body)
)
