import { route } from "@/lib/api/route"
import { getGradebook, gradebookCsv } from "@/features/assignments/server"

/** JSON for the dashboard; ?format=csv downloads it for a spreadsheet. */
export const GET = route({ access: "platform.gradebook.view" }, async ({ params, query }) => {
  const id = params.id ?? ""
  if (query.get("format") !== "csv") return getGradebook(id, null)
  const { filename, body } = await gradebookCsv(id, null)
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
})
