import { route } from "@/lib/api/route"
import { applyTemplateSchema } from "@/features/templates/schemas"
import { applyTemplate } from "@/features/templates/server"

/** The platform's own uses: no classes, so each use is for everyone, with its dates. */
export const POST = route(
  { access: "platform.work.manage", body: applyTemplateSchema },
  ({ body, params }) =>
    applyTemplate(null, params.id ?? "", { ...body, uses: body.uses.map((u) => ({ ...u, groupId: null })) }, () => "")
)
