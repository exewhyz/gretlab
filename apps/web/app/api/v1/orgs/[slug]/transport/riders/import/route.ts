import { route } from "@/lib/api/route"
import { importRiders, ridersImportSchema } from "@/features/transport/server"

export const POST = route(
  { access: "user", body: ridersImportSchema },
  ({ user, params, body }) => importRiders(params.slug ?? "", user, body)
)
