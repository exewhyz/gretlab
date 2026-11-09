import { route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { peerOverview, startPeerReview } from "@/features/peer/server"

export const GET = route({ access: "platform.gradebook.view" }, ({ params }) => peerOverview(params.id ?? "", null))

/** Hands out the reviews, once the assignment is due. */
export const POST = route({ access: "platform.work.manage" }, async ({ user, params }) => {
  const result = await startPeerReview(params.id ?? "", null)
  await writePlatformAudit(user, "assignment.peer_review", `Handed out ${result.reviews} peer reviews`)
  return result
})
