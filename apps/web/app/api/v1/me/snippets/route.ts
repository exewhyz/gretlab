import { route } from "@/lib/api/route"
import { addSnippet, mySnippets } from "@/features/feedback/server"
import { snippetSchema } from "@/features/assignments/feedback-schemas"

/** Your saved comments, to reuse when giving feedback. */
export const GET = route({ access: "user" }, ({ user }) => mySnippets(user))

export const POST = route(
  { access: "user", body: snippetSchema },
  ({ user, body }) => addSnippet(user, body.body)
)
