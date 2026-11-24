import { route } from "@/lib/api/route"
import { invoicePdf } from "@/features/billing/pay"
import { pdfResponse } from "@/lib/pdf/document"

/** A paid invoice as a PDF, for whoever manages the organization's billing. */
export const GET = route({ access: "user" }, async ({ user, params }) => {
  const { doc, filename } = await invoicePdf(
    params.slug ?? "",
    user,
    params.id ?? ""
  )
  return pdfResponse(doc, filename)
})
