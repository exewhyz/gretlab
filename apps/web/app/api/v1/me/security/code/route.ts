import { route } from "@/lib/api/route"
import { emailConfirmCode } from "@/features/auth/two-factor"

/** Emails a code to confirm a change on the security page. */
export const POST = route({ access: "user" }, ({ user }) =>
  emailConfirmCode(user)
)
