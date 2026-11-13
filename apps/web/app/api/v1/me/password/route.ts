import { route } from "@/lib/api/route"
import { changePassword, changeSchema, passwordStatus } from "@/features/auth/password"

export const GET = route({ access: "user" }, ({ user }) => passwordStatus(user))

/** Adds a password, or changes it (with the current one). */
export const PUT = route({ access: "user", body: changeSchema }, ({ user, body }) => changePassword(user, body))
