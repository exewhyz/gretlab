import { route } from "@/lib/api/route"
import { addPart, partSchema } from "@/features/jobs/imports"

/** One part of an import's rows ({ seq, rows }); sending a part again replaces it. */
export const POST = route(
  { access: "user", body: partSchema },
  ({ user, params, body }) => addPart(user, params.id ?? "", body)
)
