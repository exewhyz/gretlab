import { z } from "zod"

import { route } from "@/lib/api/route"
import { previewAudience } from "@/features/orgs/server"

/** Who an audience would reach, for the live count while choosing it. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      audience: z.array(z.array(z.uuid()).min(1).max(50)).max(5),
    }),
  },
  ({ user, params, body }) =>
    previewAudience(params.slug ?? "", user, body.audience)
)
