import { z } from "zod"

import { route } from "@/lib/api/route"
import { billingSettings, saveBillingSettings } from "@/features/billing/server"

/** Feature prices and the billing rules (Dashboard › Plans). */
export const GET = route({ access: "platform.billing.manage" }, ({ user }) =>
  billingSettings(user)
)

export const PATCH = route(
  {
    access: "platform.billing.manage",
    body: z.record(z.string(), z.unknown()),
  },
  ({ user, body }) => saveBillingSettings(user, body)
)
