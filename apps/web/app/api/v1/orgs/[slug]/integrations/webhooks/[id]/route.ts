import { z } from "zod"

import { route } from "@/lib/api/route"
import { deleteWebhook, updateWebhook } from "@/features/integrations/server"

export const PATCH = route(
  {
    access: "user",
    body: z.object({
      active: z.boolean().optional(),
      events: z.array(z.string().trim().min(1).max(80)).min(1).max(50).optional(),
    }),
  },
  async ({ user, params, body }) => {
    await updateWebhook(params.slug ?? "", user, params.id ?? "", body)
    return { ok: true }
  }
)

export const DELETE = route({ access: "user" }, async ({ user, params }) => {
  await deleteWebhook(params.slug ?? "", user, params.id ?? "")
  return { ok: true }
})
