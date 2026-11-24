import { route } from "@/lib/api/route"
import { revenue } from "@/features/billing/revenue"

/** What each organization pays a month against what its judging costs this month. */
export const GET = route({ access: "platform.billing.manage" }, ({ user }) =>
  revenue(user)
)
