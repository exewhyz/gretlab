import { z } from "zod"

import { route } from "@/lib/api/route"
import { nudgeStudents } from "@/features/classes/warnings"

const noteSchema = z.object({
  userIds: z.array(z.uuid()).min(1, "Choose who it's for").max(500),
  message: z.string().trim().min(1, "Write the note").max(2000),
})

/** A teacher's note to chosen students of the class. */
export const POST = route({ access: "user", body: noteSchema }, ({ user, params, body }) =>
  nudgeStudents(params.slug ?? "", user, params.groupId ?? "", body)
)
