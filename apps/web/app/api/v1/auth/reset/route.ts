import { route } from "@/lib/api/route"
import { resetPassword, resetSchema } from "@/features/auth/password"

/** A new password from an emailed link; every older session is signed out. */
export const POST = route({ access: "public", body: resetSchema }, ({ body }) => resetPassword(body))
