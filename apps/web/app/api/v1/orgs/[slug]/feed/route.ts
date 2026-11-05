import { route } from "@/lib/api/route"
import { orgFeed } from "@/features/orgs/content"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgFeed(params.slug ?? "", user)
)
