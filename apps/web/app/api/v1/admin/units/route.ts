import { z } from "zod"

import { route } from "@/lib/api/route"
import {
  createUnit,
  listUnitsForStaff,
  reorderUnits,
} from "@/features/problems/server"

/** The platform's units in order, each with its problems. */
export const GET = route({ access: "teacher" }, () => listUnitsForStaff())

export const POST = route(
  {
    access: "teacher",
    body: z.object({ name: z.string().trim().min(1).max(200) }),
  },
  ({ body }) => createUnit(body.name)
)

/** Units in a new order: every unit's id, once. */
export const PUT = route(
  { access: "teacher", body: z.object({ ids: z.array(z.uuid()).max(500) }) },
  ({ body }) => reorderUnits(body.ids)
)
