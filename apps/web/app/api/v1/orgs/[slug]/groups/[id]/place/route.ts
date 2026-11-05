import { z } from "zod"

import { route } from "@/lib/api/route"
import { placeInGroup } from "@/features/orgs/server"

/** Moves people sitting directly in this group into a last-level group inside it. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      into: z.uuid(),
      userIds: z.array(z.uuid()).min(1).max(1000),
    }),
  },
  ({ user, params, body }) =>
    placeInGroup(
      params.slug ?? "",
      user,
      params.id ?? "",
      body.into,
      body.userIds
    )
)
