import { route } from "@/lib/api/route"
import {
  createOrganization,
  listAllOrganizations,
} from "@/features/orgs/server"
import { orgCreateSchema } from "@/features/orgs/schemas"

export const GET = route({ access: "admin" }, ({ user }) =>
  listAllOrganizations(user)
)

export const POST = route(
  { access: "admin", body: orgCreateSchema },
  ({ user, body }) => createOrganization(user, body)
)
