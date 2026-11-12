import { route } from "@/lib/api/route"
import { admit, admitSchema } from "@/features/admissions/server"

/** Admits: creates the student's record, enrols them and links the parent. */
export const POST = route(
  { access: "user", body: admitSchema },
  ({ user, params, body }) => admit(params.slug ?? "", user, params.id ?? "", body)
)
