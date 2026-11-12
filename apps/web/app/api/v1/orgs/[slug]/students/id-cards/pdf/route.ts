import { z } from "zod"

import { ApiError, route } from "@/lib/api/route"
import { today } from "@/features/catalog/server"
import { idCardsPdf } from "@/features/records/pdf"
import { idCardData } from "@/features/records/server"
import { printedDay } from "@/lib/pdf/dates"
import { pdfResponse } from "@/lib/pdf/document"

/** ?groupId: a section's ID cards for this year, ten to an A4 sheet. */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const groupId = z.uuid().safeParse(query.get("groupId")).data
    if (!groupId) throw new ApiError(400, "bad_filter", "Choose a section.")
    const data = await idCardData(params.slug ?? "", user, groupId)
    return pdfResponse(
      await idCardsPdf(data, printedDay(await today())),
      `id-cards-${data.class}-${data.year}.pdf`
    )
  }
)
