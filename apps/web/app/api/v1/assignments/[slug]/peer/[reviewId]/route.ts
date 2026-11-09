import { route } from "@/lib/api/route"
import { reviewInputSchema } from "@/features/peer/schemas"
import { getReviewTask, saveReview } from "@/features/peer/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  getReviewTask(params.slug ?? "", user, params.reviewId ?? "")
)

/** Saves the review as a draft, or hands it in. */
export const PUT = route({ access: "user", body: reviewInputSchema }, ({ user, params, body }) =>
  saveReview(params.slug ?? "", user, params.reviewId ?? "", body)
)
