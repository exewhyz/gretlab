import { route } from "@/lib/api/route"
import { emailSchema, resendConfirmation } from "@/features/auth/password"

/** Another confirmation link, for an account that hasn't confirmed its address. */
export const POST = route({ access: "public", body: emailSchema }, ({ body }) => resendConfirmation(body.email))
