import { z } from "zod"

import { route } from "@/lib/api/route"
import { setEnquiryStatus } from "@/features/landing/enquiries"

/** Marks an enquiry handled, or new again. */
export const PATCH = route(
  { access: "platform.orgs.manage", body: z.object({ status: z.enum(["new", "handled"]) }) },
  ({ user, params, body }) => setEnquiryStatus(params.id ?? "", body.status, user)
)
