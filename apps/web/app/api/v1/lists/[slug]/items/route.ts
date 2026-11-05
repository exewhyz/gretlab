import { z } from "zod"

import { route } from "@/lib/api/route"
import { setMembership } from "@/features/catalog/server"

/** Adds or removes one problem, for the save button on a problem. */
export const PUT = route(
  {
    access: "user",
    body: z.object({ problemSlug: z.string(), member: z.boolean() }),
  },
  ({ user, params, body }) =>
    setMembership(user, params.slug ?? "", body.problemSlug, body.member)
)
