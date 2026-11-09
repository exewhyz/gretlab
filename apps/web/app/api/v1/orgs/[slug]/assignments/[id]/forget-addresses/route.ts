import { route } from "@/lib/api/route"
import { orgForgetExamAddresses } from "@/features/orgs/content"

/** Drops the network addresses an exam recorded. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  orgForgetExamAddresses(params.slug ?? "", user, params.id ?? "")
)
