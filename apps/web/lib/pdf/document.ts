import fontkit from "@pdf-lib/fontkit"
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib"

import { NOTO_SANS_BOLD, NOTO_SANS_REGULAR } from "./fonts"

/*
 * A small layout layer over pdf-lib for the school's documents (report cards, transfer
 * certificates, ID cards): A4 pages, wrapped text, tables that continue on the next page,
 * and Gretlab's colours. Measurements are PDF points (1/72 inch); mm() converts.
 */

export const A4 = { width: 595.28, height: 841.89 }
export const mm = (n: number) => (n * 72) / 25.4

const hex = (h: string): RGB =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255
  )

export const COLORS = {
  ink: hex("#26251e"),
  body: hex("#55534a"),
  muted: hex("#8a877c"),
  hairline: hex("#e3e1d8"),
  canvas: hex("#f7f7f4"),
  primary: hex("#f54e00"),
  white: rgb(1, 1, 1),
  danger: hex("#c4321b"),
}

const fontBytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"))

export interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

/** A new PDF with the embedded fonts (only the glyphs used are kept). */
export async function newDocument(meta: { title: string; author: string }) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [regular, bold] = await Promise.all([
    doc.embedFont(fontBytes(NOTO_SANS_REGULAR), { subset: true }),
    doc.embedFont(fontBytes(NOTO_SANS_BOLD), { subset: true }),
  ])
  doc.setTitle(meta.title)
  doc.setAuthor(meta.author)
  doc.setCreator("Gretlab")
  doc.setProducer("Gretlab")
  return { doc, fonts: { regular, bold } satisfies Fonts }
}

/** The PDF as a download (or shown inline in the browser). */
export async function pdfResponse(
  doc: PDFDocument,
  filename: string,
  inline = true
) {
  const bytes = await doc.save()
  const safe = filename.replace(/[^\w.-]+/g, "-")
  return new Response(
    new Blob([bytes as BlobPart], { type: "application/pdf" }),
    {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
        "cache-control": "private, no-store",
      },
    }
  )
}

/** Characters the fonts lack become "?", so a name never breaks the document. */
export function printable(fonts: Fonts, text: string) {
  return [...text]
    .map((ch) =>
      ch === "\n" ||
      fonts.regular.getCharacterSet().includes(ch.codePointAt(0)!)
        ? ch
        : "?"
    )
    .join("")
}

/** Splits text into lines that fit a width. */
export function wrap(font: PDFFont, text: string, size: number, width: number) {
  const lines: string[] = []
  for (const para of text.split("\n")) {
    let line = ""
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/** Fits one line into a width, ending with "…" when it's cut. */
export function fit(font: PDFFont, text: string, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width)
    t = t.slice(0, -1)
  return `${t}…`
}

export interface TextOptions {
  size?: number
  bold?: boolean
  color?: RGB
  x?: number
  width?: number
  align?: "left" | "center" | "right"
  lineGap?: number
}

/** Writes top to bottom on A4 pages, starting a new page when one fills. */
export class Writer {
  page: PDFPage
  y: number
  readonly margin: number
  readonly width: number
  private onPage?: (w: Writer) => void

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    opts: { margin?: number; onPage?: (w: Writer) => void } = {}
  ) {
    this.margin = opts.margin ?? mm(16)
    this.width = A4.width - 2 * this.margin
    this.onPage = opts.onPage
    this.page = doc.addPage([A4.width, A4.height])
    this.y = A4.height - this.margin
    this.onPage?.(this)
  }

  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height])
    this.y = A4.height - this.margin
    this.onPage?.(this)
  }

  /** Makes room for this much, on a new page if needed. */
  ensure(height: number) {
    if (this.y - height < this.margin) this.newPage()
  }

  gap(n: number) {
    this.y -= n
  }

  text(raw: string, o: TextOptions = {}) {
    const size = o.size ?? 10
    const font = o.bold ? this.fonts.bold : this.fonts.regular
    const x = o.x ?? this.margin
    const width = o.width ?? this.width - (x - this.margin)
    const lineHeight = size * (1.35 + (o.lineGap ?? 0))
    for (const line of wrap(font, printable(this.fonts, raw), size, width)) {
      this.ensure(lineHeight)
      const w = font.widthOfTextAtSize(line, size)
      const dx =
        o.align === "center"
          ? (width - w) / 2
          : o.align === "right"
            ? width - w
            : 0
      this.page.drawText(line, {
        x: x + dx,
        y: this.y - size,
        size,
        font,
        color: o.color ?? COLORS.ink,
      })
      this.y -= lineHeight
    }
  }

  rule(color = COLORS.hairline, thickness = 0.75) {
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.margin + this.width, y: this.y },
      thickness,
      color,
    })
  }

  /** Label: value pairs in columns. */
  facts(pairs: [string, string][], columns = 2) {
    const colW = this.width / columns
    for (let i = 0; i < pairs.length; i += columns) {
      const row = pairs.slice(i, i + columns)
      const heights = row.map(
        ([, v]) =>
          wrap(this.fonts.bold, printable(this.fonts, v), 10, colW - 8).length
      )
      const h = 12 + Math.max(...heights) * 13.5 + 6
      this.ensure(h)
      row.forEach(([k, v], j) => {
        const x = this.margin + j * colW
        this.page.drawText(printable(this.fonts, k), {
          x,
          y: this.y - 8,
          size: 8,
          font: this.fonts.regular,
          color: COLORS.muted,
        })
        wrap(this.fonts.bold, printable(this.fonts, v), 10, colW - 8).forEach(
          (line, n) =>
            this.page.drawText(line, {
              x,
              y: this.y - 21 - n * 13.5,
              size: 10,
              font: this.fonts.bold,
              color: COLORS.ink,
            })
        )
      })
      this.y -= h
    }
  }

  /**
   * A table: columns with relative widths and alignment; the header repeats on each page.
   * A row's cells may carry a colour (a failed mark) or be bold (totals).
   */
  table(
    columns: {
      label: string
      width: number
      align?: "left" | "right" | "center"
    }[],
    rows: {
      cells: (string | { text: string; color?: RGB; bold?: boolean })[]
      shade?: boolean
      bold?: boolean
    }[],
    o: { size?: number } = {}
  ) {
    const size = o.size ?? 9
    const total = columns.reduce((s, c) => s + c.width, 0)
    const widths = columns.map((c) => (c.width / total) * this.width)
    const rowH = size * 2.1
    const header = () => {
      this.ensure(rowH * 2)
      this.page.drawRectangle({
        x: this.margin,
        y: this.y - rowH,
        width: this.width,
        height: rowH,
        color: COLORS.canvas,
      })
      this.cells(
        columns.map((c) => ({ text: c.label, bold: true })),
        widths,
        columns,
        size,
        rowH,
        COLORS.body
      )
      this.y -= rowH
    }
    header()
    for (const r of rows) {
      if (this.y - rowH < this.margin) {
        this.newPage()
        header()
      }
      if (r.shade)
        this.page.drawRectangle({
          x: this.margin,
          y: this.y - rowH,
          width: this.width,
          height: rowH,
          color: COLORS.canvas,
        })
      this.cells(
        r.cells.map((c) =>
          typeof c === "string"
            ? { text: c, bold: r.bold }
            : { bold: r.bold, ...c }
        ),
        widths,
        columns,
        size,
        rowH
      )
      this.y -= rowH
      this.page.drawLine({
        start: { x: this.margin, y: this.y },
        end: { x: this.margin + this.width, y: this.y },
        thickness: 0.5,
        color: COLORS.hairline,
      })
    }
  }

  private cells(
    cells: { text: string; color?: RGB; bold?: boolean }[],
    widths: number[],
    columns: { align?: "left" | "right" | "center" }[],
    size: number,
    rowH: number,
    color = COLORS.ink
  ) {
    let x = this.margin
    cells.forEach((c, i) => {
      const font = c.bold ? this.fonts.bold : this.fonts.regular
      const w = widths[i]!
      const t = fit(font, printable(this.fonts, c.text), size, w - 8)
      const tw = font.widthOfTextAtSize(t, size)
      const align = columns[i]?.align ?? "left"
      const dx =
        align === "right" ? w - 4 - tw : align === "center" ? (w - tw) / 2 : 4
      this.page.drawText(t, {
        x: x + dx,
        y: this.y - rowH / 2 - size * 0.35,
        size,
        font,
        color: c.color ?? color,
      })
      x += w
    })
  }
}

/** The school's name and the document's title across the top of a page. */
export function letterhead(
  w: Writer,
  school: string,
  title: string,
  sub?: string
) {
  w.page.drawRectangle({
    x: 0,
    y: A4.height - 6,
    width: A4.width,
    height: 6,
    color: COLORS.primary,
  })
  w.gap(4)
  w.text(school, { size: 16, bold: true, align: "center" })
  w.text(title.toUpperCase(), { size: 9, color: COLORS.muted, align: "center" })
  if (sub) w.text(sub, { size: 9, color: COLORS.muted, align: "center" })
  w.gap(8)
  w.rule()
  w.gap(12)
}

/** A line to sign on, with its caption, at a column of the page. */
export function signature(
  w: Writer,
  label: string,
  column: number,
  of: number
) {
  const colW = w.width / of
  const x = w.margin + column * colW + 10
  w.page.drawLine({
    start: { x, y: w.y },
    end: { x: x + colW - 20, y: w.y },
    thickness: 0.6,
    color: COLORS.body,
  })
  w.page.drawText(printable(w.fonts, label), {
    x,
    y: w.y - 12,
    size: 8,
    font: w.fonts.regular,
    color: COLORS.muted,
  })
}

/** "Printed on 12 Nov 2026 by Gretlab" at the bottom of every page. */
export function footers(doc: PDFDocument, fonts: Fonts, text: string) {
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const line = printable(fonts, `${text} · page ${i + 1} of ${pages.length}`)
    const w = fonts.regular.widthOfTextAtSize(line, 7)
    p.drawText(line, {
      x: (p.getWidth() - w) / 2,
      y: mm(8),
      size: 7,
      font: fonts.regular,
      color: COLORS.muted,
    })
  })
}
