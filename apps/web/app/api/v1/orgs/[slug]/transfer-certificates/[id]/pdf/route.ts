import { route } from "@/lib/api/route"
import { transferCertificatePdf } from "@/features/records/pdf"
import { transferCertificate } from "@/features/records/server"
import { pdfResponse } from "@/lib/pdf/document"

/** A transfer certificate as issued, as a PDF. */
export const GET = route({ access: "user" }, async ({ user, params }) => {
  const tc = await transferCertificate(params.slug ?? "", user, params.id ?? "")
  return pdfResponse(
    await transferCertificatePdf(tc),
    `${tc.number}-${tc.details.name}.pdf`
  )
})
