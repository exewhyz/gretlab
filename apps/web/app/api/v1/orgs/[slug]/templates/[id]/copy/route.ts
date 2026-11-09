import { route } from "@/lib/api/route"
import { orgCopyTemplate } from "@/features/templates/org"

export const POST = route({ access: "user" }, ({ user, params }) =>
  orgCopyTemplate(params.slug ?? "", user, params.id ?? "")
)
