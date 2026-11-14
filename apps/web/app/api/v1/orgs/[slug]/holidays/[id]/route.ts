import { route } from "@/lib/api/route"
import { deleteHoliday } from "@/features/holidays/server"

export const DELETE = route({ access: "user" }, async ({ user, params }) => {
  await deleteHoliday(params.slug ?? "", user, params.id ?? "")
  return { ok: true }
})
