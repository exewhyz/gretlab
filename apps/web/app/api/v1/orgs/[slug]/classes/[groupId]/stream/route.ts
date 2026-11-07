import { z } from "zod"

import { route } from "@/lib/api/route"
import { classStream, postClassNotice } from "@/features/classes/server"

/** Notices, logged classes and new work, newest first. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  classStream(params.slug ?? "", user, params.groupId ?? "")
)

/** A notice for this class only. */
export const POST = route(
  {
    access: "user",
    body: z.object({
      text: z.string().trim().min(1, "Write something first").max(2000),
    }),
  },
  ({ user, params, body }) =>
    postClassNotice(params.slug ?? "", user, params.groupId ?? "", body.text)
)
