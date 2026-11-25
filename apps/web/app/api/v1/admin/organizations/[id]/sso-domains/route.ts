import { route } from "@/lib/api/route"
import {
  setSsoDomains,
  ssoDomainsOf,
  ssoDomainsSchema,
} from "@/features/sso/server"

/** The email domains an organization's single sign-on may vouch for. */
export const GET = route({ access: "platform.orgs.manage" }, ({ params }) =>
  ssoDomainsOf(params.id ?? "")
)

/** Platform staff confirm them (the college can't), so no college claims another's addresses. */
export const PUT = route(
  { access: "platform.orgs.manage", body: ssoDomainsSchema, stepUp: true },
  ({ user, params, body }) => setSsoDomains(user, params.id ?? "", body.domains)
)
