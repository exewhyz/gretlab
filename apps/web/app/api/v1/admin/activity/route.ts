import { route } from "@/lib/api/route"
import { auditFilters } from "@/features/audit/server"
import { platformActivity } from "@/features/platform/staff"

/** A page of the platform's activity log, with the same filters as an organization's. */
export const GET = route({ access: "platform.audit.view" }, ({ user, query }) =>
  platformActivity(user, auditFilters(query))
)
