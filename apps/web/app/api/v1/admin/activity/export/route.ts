import { route } from "@/lib/api/route"
import { auditFilters } from "@/features/audit/server"
import { exportPlatformActivity } from "@/features/platform/staff"

export const GET = route({ access: "platform.audit.view" }, ({ user, query }) =>
  exportPlatformActivity(user, auditFilters(query))
)
