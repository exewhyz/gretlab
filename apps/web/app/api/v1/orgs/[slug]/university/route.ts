import { route } from "@/lib/api/route"
import {
  collegeAffiliation,
  leaveAffiliation,
  requestAffiliation,
  requestSchema,
} from "@/features/university/affiliation"

/** A college's affiliation to a university: now and before. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  collegeAffiliation(params.slug ?? "", user)
)

/** Ask a university to affiliate: a protected action. */
export const POST = route(
  { access: "user", body: requestSchema, stepUp: true },
  ({ user, params, body }) => requestAffiliation(params.slug ?? "", user, body)
)

/** Withdraw the request, or leave the university: a protected action. */
export const DELETE = route({ access: "user", stepUp: true }, ({ user, params }) =>
  leaveAffiliation(params.slug ?? "", user)
)
