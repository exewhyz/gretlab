import { isMonitorRange } from "@workspace/judge"

import { ApiError, route } from "@/lib/api/route"
import { monitoringSeries } from "@/features/monitoring/series"

/** Each signal over time, for the charts: ?range=1h, 6h, 24h or 7d. */
export const GET = route(
  { access: "platform.monitoring.view" },
  ({ query }) => {
    const range = query.get("range") ?? "24h"
    if (!isMonitorRange(range))
      throw new ApiError(
        400,
        "invalid_query",
        "range must be 1h, 6h, 24h or 7d."
      )
    return monitoringSeries(range)
  }
)
