import { z } from "zod"

import { route } from "@/lib/api/route"
import { setOrganizationActive } from "@/features/orgs/server"

export const PATCH = route(
  { access: "admin", body: z.object({ active: z.boolean() }) },
  ({ user, params, body }) =>
    setOrganizationActive(user, params.id ?? "", body.active)
)
