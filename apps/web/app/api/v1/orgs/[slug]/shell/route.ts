import { route } from "@/lib/api/route"
import { orgShell } from "@/features/home/server"

/** What the school's sidebar and header need: who you are here, what you may open. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  orgShell(params.slug ?? "", user)
)
