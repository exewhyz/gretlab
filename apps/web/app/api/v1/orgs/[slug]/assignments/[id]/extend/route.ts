import { route } from "@/lib/api/route"
import { extendSchema } from "@/features/assignments/feedback-schemas"
import { orgExtendSitting } from "@/features/orgs/content"

/** More exam time for one student. */
export const POST = route(
  { access: "user", body: extendSchema },
  ({ user, params, body }) =>
    orgExtendSitting(params.slug ?? "", user, params.id ?? "", body)
)
