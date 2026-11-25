import { z } from "zod"

import { route } from "@/lib/api/route"
import { votePost } from "@/features/solutions/server"

/** +1 a post, or take it back. */
export const PUT = route(
  { access: "user", body: z.object({ on: z.boolean() }) },
  ({ user, params, body }) => votePost(params.id ?? "", user, body.on)
)
