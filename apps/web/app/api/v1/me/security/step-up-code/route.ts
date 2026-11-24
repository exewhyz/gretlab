import { route } from "@/lib/api/route"
import { emailStepUpCode } from "@/features/auth/two-factor"

/** Emails a code to confirm a protected action (step-up). */
export const POST = route({ access: "user" }, ({ user }) =>
  emailStepUpCode(user)
)
