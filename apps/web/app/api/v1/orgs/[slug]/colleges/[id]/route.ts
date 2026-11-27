import { route } from "@/lib/api/route"
import { decideAffiliation, decideSchema } from "@/features/university/affiliation"

/** Approve (with a college code), refuse or end an affiliation: a protected action. */
export const POST = route(
  { access: "user", body: decideSchema, stepUp: true },
  ({ user, params, body }) =>
    decideAffiliation(params.slug ?? "", user, params.id ?? "", body)
)
