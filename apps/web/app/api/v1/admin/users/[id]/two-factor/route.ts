import { route } from "@/lib/api/route"
import { resetFor } from "@/features/auth/two-factor"

/** Turns off someone's two-factor sign-in (they lost their phone and codes). */
export const DELETE = route(
  { access: "platform.users.manage" },
  ({ user, params }) => resetFor(user, params.id ?? "")
)
