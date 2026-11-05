import { z } from "zod"

import { route } from "@/lib/api/route"
import { removeFromGroup } from "@/features/orgs/server"

/** Takes several people out of the group and the groups inside it. */
export const POST = route(
  {
    access: "user",
    body: z.object({ userIds: z.array(z.uuid()).min(1).max(5000) }),
  },
  ({ user, params, body }) =>
    removeFromGroup(params.slug ?? "", user, params.id ?? "", body.userIds)
)
