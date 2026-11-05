import { route } from "@/lib/api/route"
import { deleteOrgNotice } from "@/features/orgs/content"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteOrgNotice(params.slug ?? "", user, params.id ?? "")
)
