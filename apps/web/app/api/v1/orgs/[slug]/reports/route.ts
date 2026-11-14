import { route } from "@/lib/api/route"
import { readPage } from "@/lib/api/paging"
import {
  orgReport,
  orgReportCsv,
  orgReportFigures,
  orgReportStudents,
} from "@/features/teaching/server"

/**
 * The reports. `?part=figures`: the summary, assignments and teaching, no student table.
 * `?page=`: the student table a page at a time, chosen in the database (`q`, `inactive`).
 * Neither: the whole report. `?format=csv` downloads the student table, every student.
 */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const slug = params.slug ?? ""
    const group = query.get("group") || null
    if (query.get("format") === "csv") {
      return new Response(await orgReportCsv(slug, user, group), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${slug}-students.csv"`,
          "cache-control": "no-store",
        },
      })
    }
    if (query.get("part") === "figures")
      return orgReportFigures(slug, user, group)
    const { page, q, perPage } = readPage(query)
    return page
      ? orgReportStudents(slug, user, group, {
          page,
          perPage,
          q,
          inactive: query.get("inactive") === "true",
        })
      : orgReport(slug, user, group)
  }
)
