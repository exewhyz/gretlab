import { route } from "@/lib/api/route"
import { auditFilters } from "@/features/audit/server"
import { listAudit } from "@/features/orgs/server"

/** A page of the activity log: ?q, category, actor, from, to (days), before (page marker), limit. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listAudit(params.slug ?? "", user, auditFilters(query))
)
