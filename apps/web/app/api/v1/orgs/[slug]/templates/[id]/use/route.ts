import { route } from "@/lib/api/route"
import { orgApplyTemplate } from "@/features/templates/org"
import { applyTemplateSchema } from "@/features/templates/schemas"

/** One assignment per class, each with its own dates. */
export const POST = route({ access: "user", body: applyTemplateSchema }, ({ user, params, body }) =>
  orgApplyTemplate(params.slug ?? "", user, params.id ?? "", body)
)
