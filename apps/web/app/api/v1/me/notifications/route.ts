import { personPreferencesSchema } from "@workspace/judge"
import { z } from "zod"

import { route } from "@/lib/api/route"
import {
  myPreferences,
  saveMyPreferences,
} from "@/features/notifications/policy-admin"
import { markRead, myNotifications } from "@/features/notifications/server"

/** Your notifications and reminders. */
export const GET = route({ access: "user" }, ({ user }) =>
  myNotifications(user)
)

/**
 * Mark some (`ids`) or all as read; turn all email on or off (`email`); or choose email
 * event by event (`events`). Answers with their notification settings.
 */
export const PATCH = route(
  {
    access: "user",
    body: z.object({
      read: z.union([z.literal("all"), z.array(z.uuid()).max(200)]).optional(),
      email: z.boolean().optional(),
      events: personPreferencesSchema.optional(),
    }),
  },
  async ({ user, body }) => {
    if (body.read) await markRead(user, body.read)
    if (body.email !== undefined || body.events) {
      await saveMyPreferences(user, {
        emailOn: body.email,
        events: body.events,
      })
    }
    return myPreferences(user)
  }
)
