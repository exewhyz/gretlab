import { route } from "@/lib/api/route"
import { draftSchema, myDrafts, saveDraft } from "@/features/drafts/server"

/** Your saved code on this problem, one per language. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myDrafts(user, params.slug ?? "")
)

/** Saves your code on this problem in one language, as you type. */
export const PUT = route(
  { access: "user", body: draftSchema },
  ({ user, params, body }) => saveDraft(user, params.slug ?? "", body)
)
