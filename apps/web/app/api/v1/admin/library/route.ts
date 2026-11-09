import { route } from "@/lib/api/route"
import { getLibrary } from "@/features/library/server"

/** The platform's library: its problems and questions, collections and sharing. */
export const GET = route({ access: "platform.library.manage" }, ({ user }) =>
  getLibrary(null, user.id)
)
