import { route } from "@/lib/api/route"
import { setGroupRun } from "@/features/orgs/server"
import { groupRunSchema } from "@/features/orgs/schemas"

/** A group's run dates and lead, for kinds that have them (a cohort, a pod's mentor). */
export const PUT = route({ access: "user", body: groupRunSchema }, ({ user, params, body }) =>
  setGroupRun(params.slug ?? "", user, params.id ?? "", body)
)
