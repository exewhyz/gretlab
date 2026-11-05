import { route } from "@/lib/api/route"
import { orgPractice } from "@/features/orgs/content"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgPractice(params.slug ?? "", user, params.problem ?? "")
)
