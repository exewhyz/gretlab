import { route } from "@/lib/api/route"
import { teacherHome } from "@/features/teaching/server"

/** A teacher's groups across every organization they teach in. */
export const GET = route({ access: "user" }, ({ user }) => teacherHome(user))
