import { route } from "@/lib/api/route"
import { commentOn, commentSchema } from "@/features/solutions/server"

/** A comment on a post; its author is told. */
export const POST = route(
  { access: "user", body: commentSchema },
  ({ user, params, body }) => commentOn(params.id ?? "", user, body)
)
