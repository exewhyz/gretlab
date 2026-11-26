import { myReferrals } from "@/features/referrals/server"
import { route } from "@/lib/api/route"

/** Your referral link, the organizations it brought, and what you've earned. */
export const GET = route({ access: "user" }, ({ user }) => myReferrals(user))
