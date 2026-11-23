import { getDb } from "@workspace/db"

import { route } from "@/lib/api/route"
import { getGradebook } from "@/features/assignments/server"
import { enqueue, kickJobs } from "@/features/jobs/server"

/** The platform's gradebook as CSV, as a background job, for the same people as ?format=csv. */
export const POST = route(
  { access: "platform.gradebook.view" },
  async ({ user, params }) => {
    const id = params.id ?? ""
    // Refuses an assignment that isn't the platform's (404), as the gradebook itself does.
    await getGradebook(id, null, "all", [])
    const job = await enqueue(getDb(), {
      kind: "gradebook.csv",
      orgId: null,
      userId: user.id,
      input: { assignmentId: id, scope: "all" },
    })
    kickJobs()
    return { job }
  }
)
