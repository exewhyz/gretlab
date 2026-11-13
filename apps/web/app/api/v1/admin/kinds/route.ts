import { route } from "@/lib/api/route"
import { kindsOverview } from "@/features/orgs/kinds"

/** Every kind of organization and its modules' levels (platform.kinds.manage). */
export const GET = route({ access: "user" }, ({ user }) => kindsOverview(user))
