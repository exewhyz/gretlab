import { route } from "@/lib/api/route"
import { addressCheck } from "@/features/orgs/server"

/** ?slug=: whether that organization address is free, or why not (the new-organization flows). */
export const GET = route({ access: "user" }, ({ query }) =>
  addressCheck(query.get("slug") ?? "")
)
