import { route } from "@/lib/api/route"
import {
  affiliateSharingSchema,
  shareWithAffiliates,
} from "@/features/university/sharing"

/** A university shares its own content with its affiliated colleges, or stops. */
export const POST = route(
  { access: "user", body: affiliateSharingSchema },
  ({ user, params, body }) => shareWithAffiliates(params.slug ?? "", user, body)
)
