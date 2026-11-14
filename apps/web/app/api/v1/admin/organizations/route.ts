import { route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import {
  createOrganization,
  listAllOrganizations,
} from "@/features/orgs/server"
import { orgCreateSchema } from "@/features/orgs/schemas"

export const GET = route({ access: "platform.orgs.manage" }, ({ user, query }) =>
  // With a page: 50 at a time, searched (the platform's screen); without, everyone.
  listAllOrganizations(user, {
    page: Number(query.get("page")) || undefined,
    q: query.get("q") ?? undefined,
  })
)

export const POST = route(
  { access: "platform.orgs.create", body: orgCreateSchema },
  async ({ user, body }) => {
    const org = await createOrganization(user, body)
    await writePlatformAudit(user, "org.create", `Created the organization ${body.name}`)
    return org
  }
)
