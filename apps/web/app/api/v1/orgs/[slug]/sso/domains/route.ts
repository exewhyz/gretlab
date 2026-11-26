import { route } from "@/lib/api/route"
import {
  claimDomain,
  domainClaims,
  domainSchema,
  removeDomain,
} from "@/features/sso/domains"

/** The college's verified email domains and the ones waiting for their DNS record. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  domainClaims(params.slug ?? "", user)
)

/** Starts proving a domain: answers the TXT record to add. */
export const POST = route(
  { access: "user", body: domainSchema, stepUp: true },
  ({ user, params, body }) => claimDomain(params.slug ?? "", user, body.domain)
)

/** Takes a domain (or a pending claim) away; the last one switches single sign-on off. */
export const DELETE = route(
  { access: "user", body: domainSchema, stepUp: true },
  ({ user, params, body }) => removeDomain(params.slug ?? "", user, body.domain)
)
