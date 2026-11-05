import { z } from "zod"

import { route } from "@/lib/api/route"
import { getSettings, updateSettings } from "@/features/settings/server"

export const GET = route({ access: "admin" }, () => getSettings())

export const PATCH = route(
  { access: "admin", body: z.record(z.string(), z.unknown()) },
  ({ body }) => updateSettings(body)
)
