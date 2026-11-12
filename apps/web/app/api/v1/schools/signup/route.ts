import { route } from "@/lib/api/route"
import { signupMode } from "@/features/orgs/server"

/** Whether schools can be registered here: off, review or open. */
export const GET = route({ access: "user" }, async () => ({ mode: await signupMode() }))
