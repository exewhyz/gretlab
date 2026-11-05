import { route } from "@/lib/api/route"
import { listDirectory } from "@/features/orgs/server"

/** The public directory of organizations people can find and join. */
export const GET = route({ access: "public" }, ({ query }) =>
  listDirectory(query.get("q") ?? "")
)
