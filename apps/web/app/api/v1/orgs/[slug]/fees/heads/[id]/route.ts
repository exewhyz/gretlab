import { route } from "@/lib/api/route"
import { deleteHead, saveHead } from "@/features/fees/server"
import { feeHeadSchema } from "@/features/fees/schemas"

export const PATCH = route(
  { access: "user", body: feeHeadSchema },
  ({ user, params, body }) =>
    saveHead(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteHead(params.slug ?? "", user, params.id ?? "")
)
