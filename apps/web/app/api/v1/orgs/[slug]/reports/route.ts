import { route } from "@/lib/api/route"
import { orgReport, orgReportCsv } from "@/features/teaching/server"

/** JSON for the reports page; ?format=csv downloads the student table. */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const slug = params.slug ?? ""
    const group = query.get("group") || null
    if (query.get("format") !== "csv") return orgReport(slug, user, group)
    return new Response(await orgReportCsv(slug, user, group), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-students.csv"`,
        "cache-control": "no-store",
      },
    })
  }
)
