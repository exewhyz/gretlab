import { route } from "@/lib/api/route"
import { orgLti, orgSavePlatform, platformSchema } from "@/features/lti/org"

/** The organization's LMS connections, and the addresses to give the LMS. */
export const GET = route({ access: "user" }, ({ user, params, request }) =>
  orgLti(params.slug ?? "", user, request.nextUrl.origin)
)

export const POST = route({ access: "user", body: platformSchema }, ({ user, params, body }) =>
  orgSavePlatform(params.slug ?? "", user, null, body)
)
