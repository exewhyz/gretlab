import { z } from "zod"

import { notFound, route } from "@/lib/api/route"
import { releasedCommentsOn } from "@/features/feedback/server"
import { getSubmissionFor } from "@/features/submissions/server"

export const GET = route({ access: "user" }, async ({ user, params }) => {
  const id = z.uuid().safeParse(params.id)
  if (!id.success) throw notFound("Submission not found")
  const submission = await getSubmissionFor(id.data, user)
  // A teacher's line comments, once the assignment's feedback is out.
  return { ...submission, comments: await releasedCommentsOn(id.data) }
})
