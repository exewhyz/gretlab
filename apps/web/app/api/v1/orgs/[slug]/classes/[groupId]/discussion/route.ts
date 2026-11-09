import { route } from "@/lib/api/route"
import { threadSchema } from "@/features/discussions/schemas"
import { listThreads, postThread } from "@/features/discussions/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  listThreads(params.slug ?? "", user, params.groupId ?? "")
)

export const POST = route({ access: "user", body: threadSchema }, ({ user, params, body }) =>
  postThread(params.slug ?? "", user, params.groupId ?? "", body)
)
