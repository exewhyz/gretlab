import { route } from "@/lib/api/route"
import { orgPractice } from "@/features/orgs/content"

/** The organization's problems, for its members. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgPractice(params.slug ?? "", user, null)
)
