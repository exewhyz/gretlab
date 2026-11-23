import { route } from "@/lib/api/route"
import { orgGradebookExport } from "@/features/orgs/content"

/** Starts the gradebook's CSV as a background job; GET /jobs/:id follows it. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgGradebookExport(params.slug ?? "", user, params.id ?? "")
)
