import { z } from "zod"

import { notFound, route } from "@/lib/api/route"
import { deleteSnippet } from "@/features/feedback/server"

export const DELETE = route({ access: "user" }, ({ user, params }) => {
  const id = z.uuid().safeParse(params.id)
  if (!id.success) throw notFound("Saved comment not found")
  return deleteSnippet(user, id.data)
})
