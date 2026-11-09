import { route } from "@/lib/api/route"
import { orgPeerOverview, orgStartPeerReview } from "@/features/peer/org"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgPeerOverview(params.slug ?? "", user, params.id ?? "")
)

/** Hands out the reviews, once the assignment is due. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgStartPeerReview(params.slug ?? "", user, params.id ?? "")
)
