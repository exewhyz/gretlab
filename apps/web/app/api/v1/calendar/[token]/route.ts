import { route } from "@/lib/api/route"
import { feedFor } from "@/features/calendar/server"

/**
 * A person's calendar as iCal, for Google Calendar, Outlook or Apple Calendar. The secret
 * address is the only key (calendar apps can't sign in), so it never shows marks.
 */
export const GET = route({ access: "public" }, async ({ params, request }) => {
  const token = (params.token ?? "").replace(/\.ics$/, "")
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? request.nextUrl.origin
  const body = await feedFor(token, origin)
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="calendar.ics"',
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    },
  })
})
