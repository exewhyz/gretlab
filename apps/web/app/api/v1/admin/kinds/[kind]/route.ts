import { route } from "@/lib/api/route"
import { kindPolicySchema, saveKindPolicy } from "@/features/orgs/kinds"

/** Sets modules' levels for a kind: off, optional, or on from the start. */
export const PUT = route(
  { access: "user", body: kindPolicySchema },
  ({ user, params, body }) => saveKindPolicy(user, params.kind ?? "", body)
)
