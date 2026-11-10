import { route } from "@/lib/api/route"
import { myCertificates } from "@/features/certificates/server"

export const GET = route({ access: "user" }, ({ user }) => myCertificates(user))
