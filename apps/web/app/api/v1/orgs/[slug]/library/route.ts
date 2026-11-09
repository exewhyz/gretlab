import { route } from "@/lib/api/route"
import { orgLibrary } from "@/features/library/org"

/** The college's library: its own content and what the platform shares with it. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgLibrary(params.slug ?? "", user)
)
