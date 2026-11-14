import { route } from "@/lib/api/route"
import {
  orgReport,
  orgReportCsv,
  orgReportPage,
} from "@/features/teaching/server"

/** JSON for the reports page; ?format=csv downloads the student table. */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const slug = params.slug ?? ""
    const group = query.get("group") || null
    // With a page: the student table a page at a time, filtered (the Reports screen).
    if (query.get("format") !== "csv")
      return query.get("page")
        ? orgReportPage(slug, user, group, {
            page: Number(query.get("page")) || 1,
            inactive: query.get("inactive") === "true",
            q: query.get("q") ?? undefined,
          })
        : orgReport(slug, user, group)
    return new Response(await orgReportCsv(slug, user, group), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-students.csv"`,
        "cache-control": "no-store",
      },
    })
  }
)
