import { route } from "@/lib/api/route"
import { removeConcession } from "@/features/fees/ledger"

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeConcession(params.slug ?? "", user, params.id ?? "")
)
