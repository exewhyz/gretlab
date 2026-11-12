import { z } from "zod"

import { route } from "@/lib/api/route"
import { today } from "@/features/catalog/server"
import { reportCardsPdf } from "@/features/results/pdf"
import { classReportCards } from "@/features/results/server"
import { printedDay } from "@/lib/pdf/dates"
import { pdfResponse } from "@/lib/pdf/document"

/** Every student's report card in a class, one after another (?yearId, ?published=1). */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const yearId = z.uuid().safeParse(query.get("yearId")).data
    const {
      class: name,
      year,
      cards,
    } = await classReportCards(params.slug ?? "", user, params.groupId ?? "", {
      yearId,
      publishedOnly: query.get("published") === "1",
    })
    const doc = await reportCardsPdf(cards, printedDay(await today()))
    return pdfResponse(doc, `report-cards-${name}-${year}.pdf`)
  }
)
