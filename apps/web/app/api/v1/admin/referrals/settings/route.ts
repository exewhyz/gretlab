import {
  referralSettingsSchema,
  saveReferralSettings,
} from "@/features/referrals/server"
import { route } from "@/lib/api/route"

/** The referrer's share, the window and the switch. */
export const PATCH = route(
  { access: "platform.referrals.manage", body: referralSettingsSchema },
  ({ user, body }) => saveReferralSettings(user, body)
)
