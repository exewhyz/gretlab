import { route } from "@/lib/api/route"
import { loadOrg } from "@/features/orgs/core"
import { workExecutionOptions } from "@/features/submissions/execution"

/** For the assignment and contest forms: what "where code runs" may be set to. */
export const GET = route({ access: "user" }, async ({ query }) => {
  const slug = query.get("org")
  return workExecutionOptions(slug ? (await loadOrg(slug)).id : null)
})
