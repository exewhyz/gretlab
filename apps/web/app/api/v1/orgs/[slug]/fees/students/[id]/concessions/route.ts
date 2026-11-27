import { route } from "@/lib/api/route"
import { concessionSchema, giveConcession } from "@/features/fees/ledger"

/** Gives a scholarship or concession on one of the student's plans. */
export const POST = route(
  { access: "user", body: concessionSchema },
  ({ user, params, body }) =>
    giveConcession(params.slug ?? "", user, params.id ?? "", body)
)
