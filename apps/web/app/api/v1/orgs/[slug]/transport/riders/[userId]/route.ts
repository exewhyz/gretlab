import { route } from "@/lib/api/route"
import { unassignRider } from "@/features/transport/server"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  unassignRider(params.slug ?? "", user, params.userId ?? "")
)
