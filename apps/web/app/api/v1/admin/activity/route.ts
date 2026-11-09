import { route } from "@/lib/api/route"
import { platformActivity } from "@/features/platform/staff"

/** Who changed what on the platform, newest first. */
export const GET = route({ access: "platform.audit.view" }, ({ user }) => platformActivity(user))
