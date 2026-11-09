import { route } from "@/lib/api/route"
import { listOwnedContests, saveContest } from "@/features/contests/server"
import { contestInputSchema } from "@/features/problems/schemas"

/** Platform contests. Organizations run theirs under /orgs/[slug]/contests. */
export const GET = route({ access: "platform.work.manage" }, () => listOwnedContests(null))

export const POST = route(
  { access: "platform.work.manage", body: contestInputSchema },
  ({ body }) => saveContest(null, body, null)
)
