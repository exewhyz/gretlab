import { route } from "@/lib/api/route"
import { classWarnings } from "@/features/classes/warnings"

/** Students who need attention, and why. Teachers who see the class's grades. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classWarnings(params.slug ?? "", user, params.groupId ?? "")
)
