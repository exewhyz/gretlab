import { route } from "@/lib/api/route"
import { emailSchema, forgotPassword } from "@/features/auth/password"

/** A link to choose a new password; the answer is the same whether or not there's an account. */
export const POST = route({ access: "public", body: emailSchema }, ({ body }) => forgotPassword(body.email))
