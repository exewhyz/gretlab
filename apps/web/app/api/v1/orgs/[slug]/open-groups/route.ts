import { route } from "@/lib/api/route"
import { openGroups } from "@/features/orgs/server"

/** Groups members may join themselves (kinds with open groups). */
export const GET = route({ access: "user" }, ({ user, params }) => openGroups(params.slug ?? "", user))
