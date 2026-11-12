import { ApiError, route } from "@/lib/api/route"
import {
  getRegister,
  registerQuerySchema,
  registerSaveSchema,
  saveRegister,
} from "@/features/attendance/server"

/** A group's register for one day (and period): its students and their marks. */
export const GET = route({ access: "user" }, ({ user, params, query }) => {
  const parsed = registerQuerySchema.safeParse({
    groupId: query.get("groupId"),
    day: query.get("day"),
    period: query.get("period") ?? "",
  })
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Choose a group and a day."
    )
  }
  return getRegister(params.slug ?? "", user, parsed.data)
})

/** Take or correct the register; the marks sent replace any before. */
export const PUT = route(
  { access: "user", body: registerSaveSchema },
  ({ user, params, body }) => saveRegister(params.slug ?? "", user, body)
)
