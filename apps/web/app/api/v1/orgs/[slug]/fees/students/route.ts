import { route } from "@/lib/api/route"
import { feeStudents } from "@/features/fees/ledger"

/** Students whose fees this person may see, searched, 50 a page. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  feeStudents(params.slug ?? "", user, query)
)
