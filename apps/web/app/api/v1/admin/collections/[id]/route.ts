import { route } from "@/lib/api/route"
import { collectionChangeSchema, collectionSchema } from "@/features/library/schemas"
import { changeCollection, deleteCollection, saveCollection } from "@/features/library/server"

export const PUT = route(
  { access: "platform.library.manage", body: collectionSchema },
  ({ params, body }) => saveCollection(null, params.id ?? "", body)
)

/** Adds items to the collection, or takes them out. */
export const PATCH = route(
  { access: "platform.library.manage", body: collectionChangeSchema },
  ({ user, params, body }) => changeCollection(null, params.id ?? "", body, user.id)
)

export const DELETE = route({ access: "platform.library.manage" }, ({ params }) =>
  deleteCollection(null, params.id ?? "")
)
