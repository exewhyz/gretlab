import { route } from "@/lib/api/route"
import { collectionSchema } from "@/features/library/schemas"
import { saveCollection } from "@/features/library/server"

export const POST = route(
  { access: "platform.library.manage", body: collectionSchema },
  ({ body }) => saveCollection(null, null, body)
)
