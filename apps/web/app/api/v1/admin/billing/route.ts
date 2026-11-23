import { route } from "@/lib/api/route"
import { allPlans } from "@/features/billing/server"
import { readPage } from "@/lib/api/paging"

/** Every organization's plan and use (?page, ?q), with the prices in force. */
export const GET = route(
  { access: "platform.billing.manage" },
  ({ user, query }) => allPlans(user, readPage(query))
)
