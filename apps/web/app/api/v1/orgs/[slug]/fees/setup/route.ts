import { route } from "@/lib/api/route"
import { feeSetup } from "@/features/fees/server"

/** Fees › Setup: heads, years and their plans, and the settings (never the secrets). */
export const GET = route({ access: "user" }, ({ user, params }) =>
  feeSetup(params.slug ?? "", user)
)
