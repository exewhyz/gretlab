import { route } from "@/lib/api/route"
import { myFees } from "@/features/fees/online"

/** A student's fees for themselves or a linked parent ("me": your own). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myFees(params.slug ?? "", user, params.studentId ?? "")
)
