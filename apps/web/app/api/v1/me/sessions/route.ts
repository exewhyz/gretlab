import { route } from "@/lib/api/route"
import { signOutEverywhere } from "@/features/auth/password"

/** Signs out on every device, this one included. */
export const DELETE = route({ access: "user" }, ({ user }) => signOutEverywhere(user))
