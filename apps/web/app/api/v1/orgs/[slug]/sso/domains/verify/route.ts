import { route } from "@/lib/api/route"
import { domainSchema, verifyDomain } from "@/features/sso/domains"

/** Looks the TXT record up; when it matches, the domain is the college's. */
export const POST = route(
  { access: "user", body: domainSchema, stepUp: true },
  ({ user, params, body }) => verifyDomain(params.slug ?? "", user, body.domain)
)
