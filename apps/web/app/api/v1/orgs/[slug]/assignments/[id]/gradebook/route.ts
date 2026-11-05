import { route } from "@/lib/api/route"
import { orgGradebook } from "@/features/orgs/content"

/** JSON for the dashboard; ?format=csv downloads it for a spreadsheet. */
export const GET = route(
  { access: "user" },
  async ({ user, params, query }) => {
    const slug = params.slug ?? ""
    const id = params.id ?? ""
    if (query.get("format") !== "csv")
      return orgGradebook(slug, user, id, false)
    const { filename, body } = (await orgGradebook(slug, user, id, true)) as {
      filename: string
      body: string
    }
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    })
  }
)
