import { platformCan } from "@/features/platform/access"
import { route } from "@/lib/api/route"
import { getGradebook, gradebookCsv } from "@/features/assignments/server"

/** JSON for the dashboard; ?format=csv downloads it for a spreadsheet. */
export const GET = route({ access: "platform.gradebook.view" }, async ({ user, params, query }) => {
  const id = params.id ?? ""
  if (query.get("format") !== "csv") {
    const [edit, grade, manage] = await Promise.all([
      platformCan(user, "platform.work.edit"),
      platformCan(user, "platform.work.grade"),
      platformCan(user, "platform.work.manage"),
    ])
    return {
      ...(await getGradebook(id, null)),
      /** What the page offers them: each button only where its action would be allowed. */
      can: { edit, rejudge: manage, release: grade, forgetAddresses: manage, export: true, peer: true, sendGrades: false },
    }
  }
  const { filename, body } = await gradebookCsv(id, null)
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
})
