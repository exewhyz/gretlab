import { isLanguageId } from "@workspace/judge"

import { notFound, route } from "@/lib/api/route"
import { writePlatformAudit } from "@/features/platform/staff"
import { languageUpdateSchema, updateLanguage } from "@/features/admin/server"

export const PUT = route(
  { access: "platform.languages.manage", body: languageUpdateSchema },
  async ({ user, params, body }) => {
    const id = params.id ?? ""
    if (!isLanguageId(id)) throw notFound("Unknown language")
    await updateLanguage(id, body)
    await writePlatformAudit(user, "language.update", `Changed ${id}`, { ...body })
  }
)
