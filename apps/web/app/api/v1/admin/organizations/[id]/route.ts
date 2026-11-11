import { z } from "zod"

import { route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { setOrganizationActive } from "@/features/orgs/server"

export const PATCH = route(
  { access: "platform.orgs.suspend", body: z.object({ active: z.boolean() }) },
  async ({ user, params, body }) => {
    const result = await setOrganizationActive(user, params.id ?? "", body.active)
    await writePlatformAudit(
      user,
      body.active ? "org.reactivate" : "org.suspend",
      `${body.active ? "Reactivated" : "Suspended"} an organization`,
      { org: params.id }
    )
    return result
  }
)
