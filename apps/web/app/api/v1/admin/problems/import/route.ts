import { route } from "@/lib/api/route"
import { importRequestSchema } from "@/features/problems/import"
import { importProblems } from "@/features/problems/server"

/** Problems from a problem file (docs/problem-format.md). */
export const POST = route(
  { access: "platform.library.manage", body: importRequestSchema },
  ({ body }) => importProblems(null, body.file, body)
)
