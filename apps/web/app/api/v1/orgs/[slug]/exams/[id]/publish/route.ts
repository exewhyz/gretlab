import { route } from "@/lib/api/route"
import { publishSchema, setPublished } from "@/features/results/server"

/** Publishes results to students and parents, or takes them back. */
export const POST = route(
  { access: "user", body: publishSchema },
  ({ user, params, body }) =>
    setPublished(params.slug ?? "", user, params.id ?? "", body)
)
