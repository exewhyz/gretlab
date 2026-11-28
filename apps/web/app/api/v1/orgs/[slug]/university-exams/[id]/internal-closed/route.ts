import { z } from "zod"

import { route } from "@/lib/api/route"
import { setInternalClosed } from "@/features/university/exams"

/** Closes or reopens colleges' internal marks. */
export const PUT = route(
  { access: "user", body: z.object({ closed: z.boolean() }) },
  ({ user, params, body }) =>
    setInternalClosed(params.slug ?? "", user, params.id ?? "", body.closed)
)
