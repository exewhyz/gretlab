import { route } from "@/lib/api/route"
import { importLinks, importSchema } from "@/features/parents/server"

/** Links parents from a list; reports each line. */
export const POST = route(
  { access: "user", body: importSchema },
  ({ user, params, body }) => importLinks(params.slug ?? "", user, body)
)
