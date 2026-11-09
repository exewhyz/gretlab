import { route } from "@/lib/api/route"
import { myPeerReview } from "@/features/peer/server"

/** The viewer's reviews to write, and reviews of their work. */
export const GET = route({ access: "user" }, ({ user, params }) => myPeerReview(params.slug ?? "", user))
