import { z } from "zod"

import { route } from "@/lib/api/route"
import { getDailySchedule, scheduleDaily } from "@/features/catalog/server"

export const GET = route({ access: "platform.library.manage" }, () => getDailySchedule(14))

export const PUT = route(
  {
    access: "platform.library.manage",
    body: z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      problemSlug: z.string().nullable(),
      /** Questions from the platform's bank that mark themselves, in order. */
      questionIds: z.array(z.uuid()).max(10).default([]),
    }),
  },
  ({ body }) => scheduleDaily(body.day, body.problemSlug, body.questionIds)
)
