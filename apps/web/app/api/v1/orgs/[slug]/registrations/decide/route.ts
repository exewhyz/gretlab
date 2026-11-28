import { route } from "@/lib/api/route"
import {
  decideRegistrations,
  decideRegistrationsSchema,
} from "@/features/university/registrations"

/** Approves (numbering each) or rejects waiting registrations. */
export const POST = route(
  { access: "user", body: decideRegistrationsSchema },
  ({ user, params, body }) => decideRegistrations(params.slug ?? "", user, body)
)
