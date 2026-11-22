import { after } from "next/server"

import { clientIp } from "@/lib/api/client-ip"
import { autoscaleJudges } from "@/features/judges/autoscale"
import { route } from "@/lib/api/route"
import { submissionInputSchema } from "@/features/problems/schemas"
import {
  createSubmission,
  listSubmissionsFor,
} from "@/features/submissions/server"

export const POST = route(
  { access: "user", body: submissionInputSchema },
  async ({ user, body, request }) => {
    const created = await createSubmission(user, body, clientIp(request))
    // After answering: is work waiting long enough for another judge? (Off unless switched
    // on; at most every few seconds per server.)
    after(() => autoscaleJudges())
    return created
  }
)

export const GET = route({ access: "user" }, ({ user, query }) =>
  listSubmissionsFor(user, {
    problemSlug: query.get("problem"),
    contestSlug: query.get("contest"),
  })
)
