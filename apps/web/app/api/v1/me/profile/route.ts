import { route } from "@/lib/api/route"
import { accountProfile, updateAccountProfile } from "@/features/profile/server"
import { accountProfileSchema } from "@/features/profile/schemas"

/** Account › Profile: what the person says about themselves. */
export const GET = route({ access: "user" }, ({ user }) => accountProfile(user))

export const PATCH = route(
  { access: "user", body: accountProfileSchema },
  ({ user, body }) => updateAccountProfile(user, body)
)
