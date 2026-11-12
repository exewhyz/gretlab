import { type RGB } from "pdf-lib"

import {
  COLORS,
  footers,
  letterhead,
  newDocument,
  signature,
  Writer,
} from "@/lib/pdf/document"

import type { ReportCardData } from "./server"

/*
 * Report cards as PDF: one A4 page (or more, for many subjects) per student, laid out like
 * the page at /orgs/[slug]/results/[studentId]: details, marks and grades per exam, the
 * year's weighted result, rank, result, remarks, the grading scale and lines to sign.
 */

type Cell = string | { text: string; color?: RGB; bold?: boolean }
type Row = { cells: Cell[]; shade?: boolean; bold?: boolean }

const fmt = (n: number | null | undefined) =>
  n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1)

const RESULT: Record<string, { label: string; color: RGB }> = {
  pass: { label: "Pass", color: COLORS.ink },
  fail: { label: "Needs to improve", color: COLORS.danger },
  incomplete: { label: "Marks pending", color: COLORS.muted },
  none: { label: "–", color: COLORS.muted },
}

export async function reportCardsPdf(
  cards: ReportCardData[],
  printedOn: string
) {
  const first = cards[0]
  const { doc, fonts } = await newDocument({
    title: first
      ? cards.length === 1
        ? `Report card: ${first.student.name}, ${first.year.name}`
        : `Report cards: ${first.year.class ?? ""}, ${first.year.name}`
      : "Report cards",
    author: first?.org.name ?? "Gretlab",
  })
  for (const card of cards) {
    const w = new Writer(doc, fonts)
    letterhead(w, card.org.name, "Report card", card.year.name)
    w.facts(
      [
        ["Student", card.student.name],
        ["Admission no.", card.student.admissionNo ?? "–"],
        ["Class", card.year.class ?? "–"],
        ["Roll no.", card.year.rollNo == null ? "–" : String(card.year.rollNo)],
        ...(card.year.classTeacher
          ? ([["Class teacher", card.year.classTeacher]] as [string, string][])
          : []),
      ],
      3
    )
    w.gap(10)
    if (card.exams.length === 0) {
      w.text(`No results for ${card.year.name} yet.`, {
        color: COLORS.muted,
        align: "center",
      })
    } else {
      const weighted = card.exams.some((e) => e.weight > 0)
      const columns = [
        { label: "Subject", width: 3 },
        ...card.exams.flatMap((e) => [
          {
            label: `${e.name}${e.published ? "" : " (draft)"}`,
            width: 1.6,
            align: "right" as const,
          },
          { label: "Grade", width: 0.8, align: "center" as const },
        ]),
        ...(weighted
          ? [
              { label: "Year %", width: 1.1, align: "right" as const },
              { label: "Grade", width: 0.8, align: "center" as const },
            ]
          : []),
      ]
      const rows: Row[] = card.subjects.map((s, i) => ({
        shade: i % 2 === 1,
        cells: [
          s.name,
          ...card.exams.flatMap((e) => {
            const p = e.papers.find((x) => x.subjectId === s.subjectId)
            const bad = p && (p.outcome === "fail" || p.outcome === "absent")
            return [
              {
                text: !p
                  ? ""
                  : p.absent
                    ? "AB"
                    : p.marks == null
                      ? "–"
                      : `${fmt(p.marks)}/${p.maxMarks}`,
                color: bad ? COLORS.danger : undefined,
              },
              { text: p?.grade ?? "", color: COLORS.body },
            ]
          }),
          ...(weighted
            ? [
                s.final == null ? "–" : `${fmt(s.final)}%`,
                { text: s.grade ?? "", bold: true },
              ]
            : []),
        ],
      }))
      const extra = (
        label: string,
        per: (e: ReportCardData["exams"][number]) => [string, string],
        last: [string, string] = ["", ""]
      ): Row => ({
        bold: label === "Total",
        cells: [
          label,
          ...card.exams.flatMap((e) => per(e)),
          ...(weighted ? last : []),
        ],
      })
      rows.push(
        extra(
          "Total",
          (e) => [
            e.maxMarks ? `${fmt(e.obtained)}/${e.maxMarks}` : "–",
            e.grade ?? "",
          ],
          card.final
            ? [`${fmt(card.final.percent)}%`, card.final.grade]
            : ["–", ""]
        ),
        extra("Percentage", (e) => [
          e.percent == null ? "–" : `${fmt(e.percent)}%`,
          "",
        ]),
        extra("Rank in class", (e) => [
          e.rank == null ? "–" : `${e.rank} of ${e.of}`,
          "",
        ])
      )
      rows.push({
        shade: false,
        cells: [
          "Result",
          ...card.exams.flatMap((e) => [
            {
              text: RESULT[e.result]?.label ?? "–",
              color: RESULT[e.result]?.color,
              bold: true,
            },
            "",
          ]),
          ...(weighted ? ["", ""] : []),
        ],
      })
      w.table(columns, rows, { size: card.exams.length > 3 ? 8 : 9 })
      const remarks = card.exams.filter(
        (e) => e.remark || e.subjectRemarks.length
      )
      if (remarks.length) {
        w.gap(14)
        w.text("Remarks", { bold: true, size: 11 })
        w.gap(2)
        for (const e of remarks) {
          w.text(e.name, { bold: true, size: 9, color: COLORS.body })
          if (e.remark) w.text(e.remark, { size: 10 })
          for (const r of e.subjectRemarks)
            w.text(`${r.subject}: ${r.text}`, { size: 9, color: COLORS.body })
          w.gap(4)
        }
      }
    }
    w.gap(10)
    w.text(
      `Grades: ${card.scale.map((b) => `${b.grade} ${b.min}%+`).join(" · ")}. AB: absent.`,
      { size: 8, color: COLORS.muted }
    )
    // Lines to sign, kept together at the bottom of the card.
    w.ensure(60)
    w.y = Math.min(w.y - 40, 110)
    signature(w, "Class teacher", 0, 3)
    signature(w, "Principal", 1, 3)
    signature(w, "Parent or guardian", 2, 3)
  }
  footers(doc, fonts, `Printed ${printedOn} from Gretlab`)
  return doc
}
