import { route } from "@/lib/api/route"
import { classPeople } from "@/features/classes/server"

/** Teachers and classmates, names only. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classPeople(params.slug ?? "", user, params.groupId ?? "")
)
