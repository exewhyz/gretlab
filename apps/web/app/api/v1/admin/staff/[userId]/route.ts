import { route } from "@/lib/api/route"
import { removeStaff } from "@/features/platform/staff"

/** Takes their platform access away. */
export const DELETE = route({ access: "platform.roles.manage" }, ({ user, params }) =>
  removeStaff(user, params.userId ?? "")
)
