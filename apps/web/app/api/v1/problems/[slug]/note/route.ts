import { z } from "zod"

import { ApiError, route } from "@/lib/api/route"
import { getNote, saveNote } from "@/features/catalog/server"
import { examScope } from "@/features/exams/server"

/** Notes carry answers in, so they're closed during an exam sitting. */
async function notDuringExam(userId: string) {
  if (await examScope(userId)) {
    throw new ApiError(403, "exam_locked", "Notes are closed during your exam.")
  }
}

export const GET = route({ access: "user" }, async ({ user, params }) => {
  await notDuringExam(user.id)
  return getNote(user, params.slug ?? "")
})

export const PUT = route(
  { access: "user", body: z.object({ text: z.string().max(20_000) }) },
  async ({ user, params, body }) => {
    await notDuringExam(user.id)
    return saveNote(user, params.slug ?? "", body.text)
  }
)
