import { NextResponse } from "next/server"

import { feeReport, feeReportCsv, reportQuerySchema } from "@/features/fees/reports"
import { ApiError, route } from "@/lib/api/route"

/** ?kind=collection|dues|concessions (with from/to, groupId, overdueOnly); &format=csv for a file. */
export const GET = route({ access: "user" }, async ({ user, params, query }) => {
  const parsed = reportQuerySchema.safeParse(Object.fromEntries(query))
  if (!parsed.success) throw new ApiError(400, "bad_query", "That report doesn't exist.")
  const report = await feeReport(params.slug ?? "", user, parsed.data)
  if (query.get("format") !== "csv") return report
  return new NextResponse(feeReportCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fees-${report.kind}.csv"`,
      "cache-control": "private, no-store",
    },
  })
})
