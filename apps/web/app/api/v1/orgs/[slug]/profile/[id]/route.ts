import { route } from "@/lib/api/route"
import { memberProfile, updateMemberProfile } from "@/features/profile/server"
import { memberProfileSchema } from "@/features/profile/schemas"

/** Someone's profile in this organization ("me" for your own). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  memberProfile(params.slug ?? "", user, params.id ?? "me")
)

export const PATCH = route(
  { access: "user", body: memberProfileSchema },
  ({ user, params, body }) =>
    updateMemberProfile(params.slug ?? "", user, params.id ?? "me", body)
)
