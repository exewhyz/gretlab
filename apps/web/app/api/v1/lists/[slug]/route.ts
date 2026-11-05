import { z } from "zod"

import { route } from "@/lib/api/route"
import { deleteList, getList, updateList } from "@/features/catalog/server"

export const GET = route({ access: "public" }, ({ user, params }) =>
  getList(params.slug ?? "", user)
)

export const PATCH = route(
  {
    access: "user",
    body: z.object({
      title: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(2000).optional(),
      published: z.boolean().optional(),
      problemSlugs: z.array(z.string()).max(500).optional(),
    }),
  },
  ({ user, params, body }) => updateList(user, params.slug ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteList(user, params.slug ?? "")
)
