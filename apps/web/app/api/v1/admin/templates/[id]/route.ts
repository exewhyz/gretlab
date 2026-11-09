import { route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { assignmentInputSchema } from "@/features/problems/schemas"
import { deleteTemplate, getTemplate, saveTemplate } from "@/features/templates/server"

export const GET = route({ access: "platform.work.manage" }, ({ params }) => getTemplate(null, params.id ?? ""))

/** Saves it and brings the changes to its uses that haven't opened, in every college. */
export const PUT = route(
  { access: "platform.work.manage", body: assignmentInputSchema },
  async ({ user, params, body }) => {
    const result = await saveTemplate(null, params.id ?? "", body)
    await writePlatformAudit(
      user,
      "template.update",
      `Changed the template ${result.template.title}${result.updated ? `, updating ${result.updated} unopened uses` : ""}`
    )
    return result
  }
)

export const DELETE = route({ access: "platform.work.manage" }, async ({ user, params }) => {
  const row = await deleteTemplate(null, params.id ?? "")
  await writePlatformAudit(user, "template.delete", `Deleted the template ${row.title}`)
})
