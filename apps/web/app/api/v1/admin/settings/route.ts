import { z } from "zod"

import { route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { getSettings, updateSettings } from "@/features/settings/server"

export const GET = route({ access: "platform.settings.manage" }, () => getSettings())

export const PATCH = route(
  { access: "platform.settings.manage", body: z.record(z.string(), z.unknown()) },
  async ({ user, body }) => {
    const saved = await updateSettings(body)
    await writePlatformAudit(user, "settings.update", "Changed settings", {
      keys: Object.keys(body),
    })
    return saved
  }
)
