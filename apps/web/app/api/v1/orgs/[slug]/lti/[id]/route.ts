import { route } from "@/lib/api/route"
import { orgDeletePlatform, orgSavePlatform, platformSchema } from "@/features/lti/org"

export const PUT = route({ stepUp: true, access: "user", body: platformSchema }, ({ user, params, body }) =>
  orgSavePlatform(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ stepUp: true, access: "user" }, ({ user, params }) =>
  orgDeletePlatform(params.slug ?? "", user, params.id ?? "")
)
