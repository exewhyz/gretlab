import { pdfBrand } from "@/features/orgs/pdf-brand"
import { feeReceipt } from "@/features/fees/ledger"
import { receiptPdf } from "@/features/fees/pdf"
import { route } from "@/lib/api/route"
import { pdfResponse } from "@/lib/pdf/document"

/** A fee receipt as issued, as a PDF. */
export const GET = route({ access: "user" }, async ({ user, params }) => {
  const r = await feeReceipt(params.slug ?? "", user, params.id ?? "")
  return pdfResponse(
    await receiptPdf(r.snapshot, r.status, r.cancelReason, await pdfBrand(params.slug ?? "")),
    `${r.snapshot.number.replaceAll("/", "-")}.pdf`
  )
})
