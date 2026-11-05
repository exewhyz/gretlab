import { z } from "zod"

import { route } from "@/lib/api/route"
import { addOrgNotice, orgNotices } from "@/features/orgs/content"

export const GET = route({ access: "user" }, ({ user, params }) =>
  orgNotices(params.slug ?? "", user)
)

export const POST = route(
  {
    access: "user",
    body: z.object({ text: z.string().trim().min(1).max(5000) }),
  },
  ({ user, params, body }) => addOrgNotice(params.slug ?? "", user, body.text)
)
