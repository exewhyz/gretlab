import { z } from "zod"

import { route } from "@/lib/api/route"
import { orgReportExport } from "@/features/teaching/server"

/** Starts Reports' student table as a CSV job ({ group }); GET /jobs/:id follows it. */
export const POST = route(
  {
    access: "user",
    body: z.object({ group: z.string().nullable().default(null) }),
  },
  ({ user, params, body }) =>
    orgReportExport(params.slug ?? "", user, body.group || null)
)
