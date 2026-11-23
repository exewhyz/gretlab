import { z } from "zod"

import { route } from "@/lib/api/route"
import { runImport } from "@/features/jobs/imports"

/** Checks the whole file ({ commit: false }), then adds it ({ commit: true }), as a job. */
export const POST = route(
  { access: "user", body: z.object({ commit: z.boolean().default(false) }) },
  ({ user, params, body }) => runImport(user, params.id ?? "", body.commit)
)
