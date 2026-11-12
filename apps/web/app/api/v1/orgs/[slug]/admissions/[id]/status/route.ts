import { route } from "@/lib/api/route"
import { setStatus, statusSchema } from "@/features/admissions/server"

/** Reviewing, waitlisted or rejected; the applicant is told. */
export const POST = route(
  { access: "user", body: statusSchema },
  ({ user, params, body }) =>
    setStatus(params.slug ?? "", user, params.id ?? "", body)
)
