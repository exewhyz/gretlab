import { z } from "zod"

import { route } from "@/lib/api/route"
import { addNote, listNotes } from "@/features/problems/server"

export const GET = route({ access: "teacher" }, () => listNotes(null))

export const POST = route(
  {
    access: "teacher",
    body: z.object({
      text: z.string().trim().min(1).max(5000),
      problemId: z.uuid().nullable(),
    }),
  },
  ({ body }) => addNote(body.text, body.problemId, null)
)
