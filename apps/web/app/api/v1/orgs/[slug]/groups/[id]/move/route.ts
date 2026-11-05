import { z } from "zod"

import { route } from "@/lib/api/route"
import { moveGroupPeople } from "@/features/orgs/server"

/** Moves people in the group (everyone, or `userIds`) into another group. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      into: z.uuid(),
      /** Only these people; everyone when left out. */
      userIds: z.array(z.uuid()).max(5000).optional(),
    }),
  },
  ({ user, params, body }) =>
    moveGroupPeople(
      params.slug ?? "",
      user,
      params.id ?? "",
      body.into,
      body.userIds
    )
)
