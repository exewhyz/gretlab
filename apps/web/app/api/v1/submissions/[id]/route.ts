import { z } from "zod"

import { notFound, route } from "@/lib/api/route"
import { getSubmissionFor } from "@/features/submissions/server"

export const GET = route({ access: "user" }, async ({ user, params }) => {
  const id = z.uuid().safeParse(params.id)
  if (!id.success) throw notFound("Submission not found")
  return getSubmissionFor(id.data, user)
})
