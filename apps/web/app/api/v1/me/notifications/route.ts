import { z } from "zod"

import { route } from "@/lib/api/route"
import {
  markRead,
  myNotifications,
  setEmailNotifications,
} from "@/features/notifications/server"

/** Your notifications and reminders. */
export const GET = route({ access: "user" }, ({ user }) => myNotifications(user))

/** Mark some (`ids`) or all as read; or turn email on or off (`email`). */
export const PATCH = route(
  {
    access: "user",
    body: z.object({
      read: z.union([z.literal("all"), z.array(z.uuid()).max(200)]).optional(),
      email: z.boolean().optional(),
    }),
  },
  async ({ user, body }) => {
    if (body.read) await markRead(user, body.read)
    if (body.email !== undefined) await setEmailNotifications(user, body.email)
  }
)
