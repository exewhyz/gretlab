import { isLanguageId } from "@workspace/judge"

import { notFound, route } from "@/lib/api/route"
import { languageUpdateSchema, updateLanguage } from "@/features/admin/server"

export const PUT = route(
  { access: "admin", body: languageUpdateSchema },
  async ({ params, body }) => {
    const id = params.id ?? ""
    if (!isLanguageId(id)) throw notFound("Unknown language")
    await updateLanguage(id, body)
  }
)
