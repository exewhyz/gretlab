import { route } from "@/lib/api/route"
import {
  importResidents,
  residentsImportSchema,
} from "@/features/hostel/server"

export const POST = route(
  { access: "user", body: residentsImportSchema },
  ({ user, params, body }) => importResidents(params.slug ?? "", user, body)
)
