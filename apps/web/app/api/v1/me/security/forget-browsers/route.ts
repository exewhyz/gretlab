import { route } from "@/lib/api/route"
import { forgetBrowsers } from "@/features/auth/two-factor"

/** Every browser trusted for 30 days asks for the second step again. */
export const POST = route({ access: "user" }, ({ user }) =>
  forgetBrowsers(user)
)
