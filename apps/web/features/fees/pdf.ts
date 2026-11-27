import { printedDay } from "@/lib/pdf/dates"
import {
  COLORS,
  embedBrand,
  footers,
  letterhead,
  mm,
  newDocument,
  signature,
  Writer,
} from "@/lib/pdf/document"

import { MODE_LABEL, type ReceiptSnapshot } from "./ledger"

const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`

/** A fee receipt as issued. A cancelled one says so across the top, with the reason. */
export async function receiptPdf(
  r: ReceiptSnapshot,
  status: string,
  cancelReason: string | null,
  branding: Parameters<typeof embedBrand>[1] = null
) {
  const { doc, fonts } = await newDocument({
    title: `Fee receipt ${r.number}: ${r.student.name}`,
    author: r.org.name,
  })
  const w = new Writer(doc, fonts, { margin: mm(20) })
  const taxed = r.lines.some((l) => l.gstRate > 0)
  letterhead(
    w,
    r.org.name,
    taxed ? "Fee receipt and tax invoice" : "Fee receipt",
    r.org.gstin ? `GSTIN ${r.org.gstin}` : undefined,
    await embedBrand(doc, branding)
  )
  if (status === "cancelled") {
    w.text(`CANCELLED${cancelReason ? `: ${cancelReason}` : ""}`, {
      bold: true,
      size: 11,
      color: COLORS.danger,
    })
    w.gap(6)
  }
  w.facts([
    ["Receipt", r.number],
    ["Date", printedDay(r.date.slice(0, 10))],
    ["Student", r.student.name],
    ["Admission no.", r.student.admissionNo ?? "–"],
    ["Fee plan", r.plan],
    [
      "Paid by",
      `${MODE_LABEL[r.mode] ?? r.mode}${r.reference ? ` · ${r.reference}` : ""}`,
    ],
  ])
  w.gap(10)
  const columns = taxed
    ? [
        { label: "Instalment", width: 2 },
        { label: "Fee head", width: 2.4 },
        { label: "Taxable", width: 1.4, align: "right" as const },
        { label: "CGST", width: 1.1, align: "right" as const },
        { label: "SGST", width: 1.1, align: "right" as const },
        { label: "Amount", width: 1.4, align: "right" as const },
      ]
    : [
        { label: "Instalment", width: 2 },
        { label: "Fee head", width: 3 },
        { label: "Amount", width: 1.4, align: "right" as const },
      ]
  w.table(columns, [
    ...r.lines.map((l) => ({
      cells: taxed
        ? [
            l.instalment,
            l.gstRate ? `${l.head} (GST ${l.gstRate}%)` : l.head,
            rs(l.taxable),
            rs(l.cgst),
            rs(l.sgst),
            rs(l.amount),
          ]
        : [l.instalment, l.head, rs(l.amount)],
    })),
    {
      cells: taxed
        ? ["Total", "", "", "", "", rs(r.total)]
        : ["Total", "", rs(r.total)],
      bold: true,
      shade: true,
    },
  ])
  w.gap(10)
  w.text(`Received with thanks: ${rs(r.total)}.`, { size: 10 })
  w.ensure(90)
  w.y = Math.min(w.y - 60, 140)
  signature(w, `Collected by${r.collectedBy ? `: ${r.collectedBy}` : ""}`, 0, 2)
  signature(w, "Accounts (with seal)", 1, 2)
  footers(doc, fonts, `${r.number} · printed from GretLab`)
  return doc
}
