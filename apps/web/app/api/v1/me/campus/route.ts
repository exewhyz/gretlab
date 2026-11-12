import { route } from "@/lib/api/route"
import { myCampus } from "@/features/campus/server"

/** Library books (and later bus and hostel) per organization. */
export const GET = route({ access: "user" }, ({ user }) => myCampus(user))
