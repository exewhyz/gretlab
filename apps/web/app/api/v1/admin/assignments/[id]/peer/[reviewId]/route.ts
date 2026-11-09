import { z } from "zod"

import { route } from "@/lib/api/route"
import { hideReview } from "@/features/peer/server"

/** Hides a review from its author, or shows it again. */
export const PATCH = route(
  { access: "platform.gradebook.view", body: z.object({ hidden: z.boolean() }) },
  ({ params, body }) => hideReview(params.id ?? "", null, params.reviewId ?? "", body.hidden)
)
