import { route } from "@/lib/api/route"
import { saveHead } from "@/features/fees/server"
import { feeHeadSchema } from "@/features/fees/schemas"

export const POST = route(
  { access: "user", body: feeHeadSchema },
  ({ user, params, body }) => saveHead(params.slug ?? "", user, null, body)
)
