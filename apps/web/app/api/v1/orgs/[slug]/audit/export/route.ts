import { route } from "@/lib/api/route"
import { auditFilters } from "@/features/audit/server"
import { exportAudit } from "@/features/orgs/server"

/** The activity log as CSV, with the same filters. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  exportAudit(params.slug ?? "", user, auditFilters(query))
)
