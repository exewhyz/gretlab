import { route } from "@/lib/api/route"
import { myChildren } from "@/features/parents/server"

/** The children this person is linked to as a parent. */
export const GET = route({ access: "user" }, ({ user }) => myChildren(user))
