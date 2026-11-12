import { z } from "zod"

import { route } from "@/lib/api/route"
import { today } from "@/features/catalog/server"
import { reportCardsPdf } from "@/features/results/pdf"
import { reportCard } from "@/features/results/server"
import { printedDay } from "@/lib/pdf/dates"
import { pdfResponse } from "@/lib/pdf/document"

/** A student's report card as a PDF ("me" for your own), for ?yearId or the latest year. */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const yearId = z.uuid().safeParse(query.get("yearId")).data
    const card = await reportCard(
      params.slug ?? "",
      user,
      params.studentId ?? "",
      yearId
    )
    const doc = await reportCardsPdf([card], printedDay(await today()))
    return pdfResponse(
      doc,
      `report-card-${card.student.name}-${card.year.name}.pdf`
    )
  }
)
