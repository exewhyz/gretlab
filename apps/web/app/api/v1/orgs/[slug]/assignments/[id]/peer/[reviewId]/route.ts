import { z } from "zod"

import { route } from "@/lib/api/route"
import { orgHideReview } from "@/features/peer/org"

/** Hides a review from its author, or shows it again. */
export const PATCH = route({ access: "user", body: z.object({ hidden: z.boolean() }) }, ({ user, params, body }) =>
  orgHideReview(params.slug ?? "", user, params.id ?? "", params.reviewId ?? "", body.hidden)
)
