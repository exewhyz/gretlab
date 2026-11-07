import { route } from "@/lib/api/route"
import { myClasses } from "@/features/classes/server"

/** The classes the signed-in person sits in, by organization. */
export const GET = route({ access: "user" }, ({ user }) => myClasses(user))
