import { route } from "@/lib/api/route"
import { orgImportProblems } from "@/features/orgs/content"
import { importRequestSchema } from "@/features/problems/import"

/** Problems from a problem file (docs/problem-format.md). */
export const POST = route(
  { access: "user", body: importRequestSchema },
  ({ user, params, body }) => orgImportProblems(params.slug ?? "", user, body)
)
