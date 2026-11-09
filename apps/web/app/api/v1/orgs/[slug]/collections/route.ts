import { route } from "@/lib/api/route"
import { orgSaveCollection } from "@/features/library/org"
import { collectionSchema } from "@/features/library/schemas"

export const POST = route(
  { access: "user", body: collectionSchema },
  ({ user, params, body }) => orgSaveCollection(params.slug ?? "", user, null, body)
)
