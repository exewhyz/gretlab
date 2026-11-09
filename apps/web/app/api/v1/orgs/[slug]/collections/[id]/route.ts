import { route } from "@/lib/api/route"
import {
  orgChangeCollection,
  orgDeleteCollection,
  orgSaveCollection,
} from "@/features/library/org"
import { collectionChangeSchema, collectionSchema } from "@/features/library/schemas"

export const PUT = route(
  { access: "user", body: collectionSchema },
  ({ user, params, body }) => orgSaveCollection(params.slug ?? "", user, params.id ?? "", body)
)

export const PATCH = route(
  { access: "user", body: collectionChangeSchema },
  ({ user, params, body }) => orgChangeCollection(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  orgDeleteCollection(params.slug ?? "", user, params.id ?? "")
)
