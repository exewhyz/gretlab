import { route } from "@/lib/api/route"
import { listOwnedContests, saveContest } from "@/features/contests/server"
import { contestInputSchema } from "@/features/problems/schemas"

/** Platform contests. Organizations run theirs under /orgs/[slug]/contests. */
// Reviewers of submissions choose a contest to check for copying.
export const GET = route({ access: ["platform.work.manage", "platform.submissions.view"] }, () => listOwnedContests(null))

export const POST = route(
  { access: "platform.work.create", body: contestInputSchema },
  ({ body }) => saveContest(null, body, null)
)
