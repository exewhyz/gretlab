import { z } from "zod"

import { route } from "@/lib/api/route"
import {
  deleteUnit,
  renameUnit,
  setUnitProblems,
} from "@/features/problems/server"

/**
 * Rename it, and/or set its problems: exactly `problemIds`, in order (others join it);
 * its problems left out go where `moves` says (a unit id, or null for none).
 */
export const PATCH = route(
  {
    access: "teacher",
    body: z.object({
      name: z.string().trim().min(1, "Name the unit").max(200).optional(),
      problemIds: z.array(z.uuid()).max(1000).optional(),
      moves: z.record(z.uuid(), z.uuid().nullable()).default({}),
    }),
  },
  async ({ params, body }) => {
    const id = params.id ?? ""
    if (body.name !== undefined) await renameUnit(id, body.name)
    if (body.problemIds) await setUnitProblems(id, body.problemIds, body.moves)
  }
)

/** ?moveTo=<unit id>: where its problems go; without it they go to no unit. */
export const DELETE = route({ access: "teacher" }, ({ params, query }) =>
  deleteUnit(params.id ?? "", query.get("moveTo") || null)
)
