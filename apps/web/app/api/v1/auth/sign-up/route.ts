import { route } from "@/lib/api/route"
import { signUp, signUpSchema } from "@/features/auth/password"

/** A new account with email and password; a link to confirm the address follows by email. */
export const POST = route({ access: "public", body: signUpSchema }, ({ body }) => signUp(body))
