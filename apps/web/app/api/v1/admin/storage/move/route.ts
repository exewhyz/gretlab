import { getDb } from "@workspace/db"

import { ApiError, route } from "@/lib/api/route"
import { enqueue, kickJobs } from "@/features/jobs/server"
import { storageReady } from "@/lib/storage"

/** Starts moving the images kept in the database to R2 (a background job; GET /jobs/:id). */
export const POST = route(
  { access: "platform.settings.manage" },
  async ({ user }) => {
    if (!storageReady())
      throw new ApiError(
        409,
        "storage_not_set_up",
        "File storage (R2) isn't set up on this server: see README › File storage."
      )
    const job = await enqueue(getDb(), {
      kind: "uploads.move",
      orgId: null,
      userId: user.id,
      input: {},
    })
    kickJobs()
    return { job }
  }
)
