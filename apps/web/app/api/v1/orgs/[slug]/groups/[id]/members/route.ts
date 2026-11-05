import { z } from "zod"

import { route } from "@/lib/api/route"
import { addToGroup, groupPeople } from "@/features/orgs/server"

/** Everyone in the group or a group inside it. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  groupPeople(params.slug ?? "", user, params.id ?? "")
)

export const POST = route(
  {
    access: "user",
    body: z.object({ userIds: z.array(z.uuid()).min(1).max(1000) }),
  },
  ({ user, params, body }) =>
    addToGroup(params.slug ?? "", user, params.id ?? "", body.userIds)
)
