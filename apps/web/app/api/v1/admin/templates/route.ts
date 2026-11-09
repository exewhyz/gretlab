import { route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { assignmentInputSchema } from "@/features/problems/schemas"
import { listTemplates, saveTemplate } from "@/features/templates/server"

export const GET = route({ access: "platform.work.manage" }, () => listTemplates(null))

export const POST = route(
  { access: "platform.work.manage", body: assignmentInputSchema },
  async ({ user, body }) => {
    const result = await saveTemplate(null, null, body)
    await writePlatformAudit(user, "template.create", `Created the template ${result.template.title}`)
    return result
  }
)
