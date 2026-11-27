import { route } from "@/lib/api/route"
import { studentFees } from "@/features/fees/ledger"

/** A student's fee plans, each with its ledger, payments and concessions. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  studentFees(params.slug ?? "", user, params.id ?? "")
)
