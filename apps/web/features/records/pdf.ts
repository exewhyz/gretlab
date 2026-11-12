import { printedDay } from "@/lib/pdf/dates"
import {
  A4,
  COLORS,
  fit,
  footers,
  letterhead,
  mm,
  newDocument,
  printable,
  signature,
  Writer,
} from "@/lib/pdf/document"

import type { idCardData, transferCertificate } from "./server"

/*
 * Student records as PDF: a transfer certificate (one A4 page, as issued) and ID cards (a
 * class's cards, ten to an A4 sheet at the standard 85.6 × 54 mm, with light borders to
 * cut along).
 */

const GENDER: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
}

export async function transferCertificatePdf(
  tc: Awaited<ReturnType<typeof transferCertificate>>
) {
  const d = tc.details
  const { doc, fonts } = await newDocument({
    title: `Transfer certificate ${tc.number}: ${d.name}`,
    author: tc.org.name,
  })
  const w = new Writer(doc, fonts, { margin: mm(20) })
  letterhead(w, tc.org.name, "Transfer certificate")
  w.text(`No. ${tc.number}`, { bold: true, size: 10 })
  w.text(`Issued on ${printedDay(tc.issuedOn)}`, {
    size: 9,
    color: COLORS.muted,
  })
  w.gap(14)
  const parents = d.parents.length
    ? d.parents
        .map((p) => (p.relation ? `${p.name} (${p.relation})` : p.name))
        .join(", ")
    : "–"
  const lines: [string, string][] = [
    ["1. Name of the student", d.name],
    ["2. Admission number", d.admissionNo],
    ["3. Date of birth", d.birthDate ? printedDay(d.birthDate) : "–"],
    ["4. Gender", GENDER[d.gender] ?? "–"],
    ["5. Parents or guardians", parents],
    ["6. Date of admission", printedDay(d.admittedOn)],
    [
      "7. Class last studied in",
      d.lastClass
        ? `${d.lastClass}${d.lastYear ? `, ${d.lastYear}` : ""}`
        : "–",
    ],
    ["8. Roll number", d.rollNo == null ? "–" : String(d.rollNo)],
    ["9. Date of leaving", printedDay(tc.leavingDate)],
    ["10. Reason for leaving", tc.reason || "–"],
    ["11. Conduct", tc.conduct || "–"],
    ["12. Remarks", tc.remarks || "–"],
  ]
  const labelW = w.width * 0.42
  for (const [k, v] of lines) {
    const top = w.y
    w.text(k, { size: 10, color: COLORS.body, width: labelW - 8 })
    const afterLabel = w.y
    w.y = top
    w.text(v, {
      size: 10,
      bold: true,
      x: w.margin + labelW,
      width: w.width - labelW,
    })
    w.y = Math.min(w.y, afterLabel) - 6
    w.page.drawLine({
      start: { x: w.margin, y: w.y + 3 },
      end: { x: w.margin + w.width, y: w.y + 3 },
      thickness: 0.4,
      color: COLORS.hairline,
    })
  }
  w.gap(16)
  w.text(
    "Certified that the above information is in accordance with the school's records.",
    { size: 9, color: COLORS.body }
  )
  w.ensure(90)
  w.y = Math.min(w.y - 60, 140)
  signature(w, `Prepared by${tc.issuedBy ? `: ${tc.issuedBy}` : ""}`, 0, 3)
  signature(w, "Checked by", 1, 3)
  signature(w, "Principal (with seal)", 2, 3)
  footers(doc, fonts, `${tc.number} · printed from Gretlab`)
  return doc
}

export async function idCardsPdf(
  data: Awaited<ReturnType<typeof idCardData>>,
  printedOn: string
) {
  const { doc, fonts } = await newDocument({
    title: `ID cards: ${data.class}, ${data.year}`,
    author: data.org.name,
  })
  const cardW = mm(85.6)
  const cardH = mm(54)
  const gapX = mm(8)
  const gapY = mm(4)
  const cols = 2
  const rows = 5
  const left = (A4.width - cols * cardW - (cols - 1) * gapX) / 2
  const top = A4.height - (A4.height - rows * cardH - (rows - 1) * gapY) / 2
  const perPage = cols * rows
  const t = (s: string) => printable(fonts, s)
  let page = doc.addPage([A4.width, A4.height])
  data.students.forEach((s, i) => {
    if (i > 0 && i % perPage === 0) page = doc.addPage([A4.width, A4.height])
    const n = i % perPage
    const x = left + (n % cols) * (cardW + gapX)
    const y = top - Math.floor(n / cols) * (cardH + gapY) - cardH
    // The card and its band.
    page.drawRectangle({
      x,
      y,
      width: cardW,
      height: cardH,
      borderColor: COLORS.hairline,
      borderWidth: 0.6,
      color: COLORS.white,
    })
    const band = mm(11)
    page.drawRectangle({
      x,
      y: y + cardH - band,
      width: cardW,
      height: band,
      color: COLORS.primary,
    })
    page.drawText(fit(fonts.bold, t(data.org.name), 9.5, cardW - mm(8)), {
      x: x + mm(4),
      y: y + cardH - mm(5.6),
      size: 9.5,
      font: fonts.bold,
      color: COLORS.white,
    })
    page.drawText(t(`Student ID card · ${data.year}`), {
      x: x + mm(4),
      y: y + cardH - mm(9.2),
      size: 6.5,
      font: fonts.regular,
      color: COLORS.white,
    })
    // A circle with initials where a photo would go.
    const r = mm(9)
    const cx = x + mm(4) + r
    const cy = y + cardH - band - mm(4) - r
    page.drawCircle({
      x: cx,
      y: cy,
      size: r,
      color: COLORS.canvas,
      borderColor: COLORS.hairline,
      borderWidth: 0.6,
    })
    const initials = t(
      s.name
        .split(/\s+/)
        .map((p) => p[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase()
    )
    const iw = fonts.bold.widthOfTextAtSize(initials, 13)
    page.drawText(initials, {
      x: cx - iw / 2,
      y: cy - 4.5,
      size: 13,
      font: fonts.bold,
      color: COLORS.body,
    })
    // The details.
    const tx = x + mm(4) + 2 * r + mm(4)
    const tw = x + cardW - mm(4) - tx
    let ty = y + cardH - band - mm(5.5)
    page.drawText(fit(fonts.bold, t(s.name), 10.5, tw), {
      x: tx,
      y: ty,
      size: 10.5,
      font: fonts.bold,
      color: COLORS.ink,
    })
    ty -= 12.5
    const facts: [string, string][] = [
      [
        "Class",
        `${data.class}${s.rollNo != null ? ` · Roll ${s.rollNo}` : ""}`,
      ],
      ["Adm. no.", s.admissionNo],
      ...(s.birthDate
        ? ([["Born", printedDay(s.birthDate)]] as [string, string][])
        : []),
      ...(s.parent ? ([["Parent", s.parent]] as [string, string][]) : []),
      ...(s.phone ? ([["Phone", s.phone]] as [string, string][]) : []),
    ]
    for (const [k, v] of facts.slice(0, 5)) {
      page.drawText(t(k), {
        x: tx,
        y: ty,
        size: 6.5,
        font: fonts.regular,
        color: COLORS.muted,
      })
      page.drawText(fit(fonts.regular, t(v), 7.5, tw - mm(12)), {
        x: tx + mm(12),
        y: ty,
        size: 7.5,
        font: fonts.regular,
        color: COLORS.ink,
      })
      ty -= 10
    }
    page.drawText(
      fit(
        fonts.regular,
        t(`If found, please return to ${data.org.name}.`),
        5.5,
        cardW - mm(8)
      ),
      {
        x: x + mm(4),
        y: y + mm(2.5),
        size: 5.5,
        font: fonts.regular,
        color: COLORS.muted,
      }
    )
  })
  if (data.students.length === 0) {
    const msg = t(`No students in ${data.class} this year.`)
    page.drawText(msg, {
      x: mm(20),
      y: A4.height - mm(30),
      size: 11,
      font: fonts.regular,
      color: COLORS.body,
    })
  }
  footers(
    doc,
    fonts,
    `${data.class}, ${data.year} · printed ${printedOn} from Gretlab`
  )
  return doc
}
