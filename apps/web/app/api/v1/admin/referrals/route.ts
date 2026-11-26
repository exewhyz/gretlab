import { adminReferrals } from "@/features/referrals/server"
import { route } from "@/lib/api/route"

/** Dashboard › Referrals: codes, referrals, earnings and the rules. */
export const GET = route({ access: "platform.referrals.manage" }, () =>
  adminReferrals()
)
