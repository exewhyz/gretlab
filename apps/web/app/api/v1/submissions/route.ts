import { clientIp } from "@/lib/api/client-ip"
import { route } from "@/lib/api/route"
import { submissionInputSchema } from "@/features/problems/schemas"
import {
  createSubmission,
  listSubmissionsFor,
} from "@/features/submissions/server"

export const POST = route(
  { access: "user", body: submissionInputSchema },
  ({ user, body, request }) => createSubmission(user, body, clientIp(request))
)

export const GET = route({ access: "user" }, ({ user, query }) =>
  listSubmissionsFor(user, {
    problemSlug: query.get("problem"),
    contestSlug: query.get("contest"),
  })
)
