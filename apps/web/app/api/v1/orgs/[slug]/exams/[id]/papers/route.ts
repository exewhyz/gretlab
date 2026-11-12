import { route } from "@/lib/api/route"
import { addPapers, papersSchema } from "@/features/results/server"

/** A paper for each subject of each chosen class; existing ones are left alone. */
export const POST = route(
  { access: "user", body: papersSchema },
  ({ user, params, body }) =>
    addPapers(params.slug ?? "", user, params.id ?? "", body)
)
