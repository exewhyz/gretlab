import { z } from "zod"

import { route } from "@/lib/api/route"
import { readPage } from "@/lib/api/paging"
import { listEnquiries } from "@/features/landing/enquiries"

const status = z.enum(["new", "handled"]).optional()

/** Enquiries from the landing page, 50 a page, newest first; ?status= and ?q= filter. */
export const GET = route({ access: "platform.orgs.manage" }, ({ query }) => {
  const page = readPage(query)
  const parsed = status.safeParse(query.get("status") || undefined)
  return listEnquiries({ page: page.page ?? 1, perPage: page.perPage ?? 50, q: page.q, status: parsed.success ? parsed.data : undefined })
})
