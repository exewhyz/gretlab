import { route } from "@/lib/api/route"
import { classOverview } from "@/features/classes/server"

/** A class: the group, its sub-classes, teachers and what the viewer may do. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classOverview(params.slug ?? "", user, params.groupId ?? "")
)
