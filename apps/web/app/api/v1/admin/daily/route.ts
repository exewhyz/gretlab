import { z } from "zod"

import { route } from "@/lib/api/route"
import { getDailySchedule, scheduleDaily } from "@/features/catalog/server"

export const GET = route({ access: "teacher" }, () => getDailySchedule(14))

export const PUT = route(
  {
    access: "teacher",
    body: z.object({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      problemSlug: z.string().nullable(),
    }),
  },
  ({ body }) => scheduleDaily(body.day, body.problemSlug)
)
