import { route } from "@/lib/api/route"
import { actOnLoan, loanActionSchema } from "@/features/books/server"

/** Return, renew, or mark lost. */
export const POST = route(
  { access: "user", body: loanActionSchema },
  ({ user, params, body }) =>
    actOnLoan(params.slug ?? "", user, params.id ?? "", body)
)
