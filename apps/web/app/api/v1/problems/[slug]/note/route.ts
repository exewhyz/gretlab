import { z } from "zod"

import { route } from "@/lib/api/route"
import { getNote, saveNote } from "@/features/catalog/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  getNote(user, params.slug ?? "")
)

export const PUT = route(
  { access: "user", body: z.object({ text: z.string().max(20_000) }) },
  ({ user, params, body }) => saveNote(user, params.slug ?? "", body.text)
)
