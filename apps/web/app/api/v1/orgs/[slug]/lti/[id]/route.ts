import { route } from "@/lib/api/route"
import { orgDeletePlatform, orgSavePlatform, platformSchema } from "@/features/lti/org"

export const PUT = route({ access: "user", body: platformSchema }, ({ user, params, body }) =>
  orgSavePlatform(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  orgDeletePlatform(params.slug ?? "", user, params.id ?? "")
)
