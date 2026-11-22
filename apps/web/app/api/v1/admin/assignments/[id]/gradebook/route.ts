import { platformCan } from "@/features/platform/access"
import { route } from "@/lib/api/route"
import {
  getGradebook,
  gradebookCsv,
  gradebookPage,
} from "@/features/assignments/server"
import { readPage } from "@/lib/api/paging"

/**
 * JSON for the dashboard; with ?page (and ?q, ?perPage) one page of students, the summary still
 * counting everyone; ?format=csv downloads it all for a spreadsheet.
 */
export const GET = route(
  { access: "platform.gradebook.view" },
  async ({ user, params, query }) => {
    const id = params.id ?? ""
    if (query.get("format") !== "csv") {
      const [edit, grade, manage] = await Promise.all([
        platformCan(user, "platform.work.edit"),
        platformCan(user, "platform.work.grade"),
        platformCan(user, "platform.work.manage"),
      ])
      const view = readPage(query)
      const book = await getGradebook(id, null)
      return {
        ...(view.page ? gradebookPage(book, view) : { ...book, paging: null }),
        /** What the page offers them: each button only where its action would be allowed. */
        can: {
          edit,
          rejudge: manage,
          release: grade,
          forgetAddresses: manage,
          export: true,
          peer: true,
          sendGrades: false,
        },
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
  }
)
