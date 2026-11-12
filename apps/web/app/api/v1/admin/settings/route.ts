import { z } from "zod"

import { twoFactorOn } from "@/features/auth/two-factor"
import { ApiError, route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { getSettings, updateSettings } from "@/features/settings/server"

export const GET = route({ access: "platform.settings.manage" }, () =>
  getSettings()
)

export const PATCH = route(
  {
    access: "platform.settings.manage",
    body: z.record(z.string(), z.unknown()),
  },
  async ({ user, body }) => {
    // Requiring two-factor of staff without using it yourself would lock you out at once.
    const rule = body["security.require_2fa"]
    if (
      (rule === "staff" || rule === "everyone") &&
      !(await twoFactorOn([user.id])).has(user.id)
    ) {
      throw new ApiError(
        400,
        "two_factor_first",
        "Turn on two-factor sign-in for yourself (Security, in your account menu) before requiring it."
      )
    }
    const saved = await updateSettings(body)
    await writePlatformAudit(user, "settings.update", "Changed settings", {
      keys: Object.keys(body),
    })
    return saved
  }
)
