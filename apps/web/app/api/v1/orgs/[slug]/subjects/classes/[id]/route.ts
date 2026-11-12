import { route } from "@/lib/api/route"
import { unassignSubject } from "@/features/subjects/server"

/** Take a subject off a class. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  unassignSubject(params.slug ?? "", user, params.id ?? "")
)
