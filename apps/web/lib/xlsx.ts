import { unzipSync, strFromU8 } from "fflate"

/**
 * The first worksheet of an .xlsx file as rows of text, in the browser. Reads shared and
 * inline strings, numbers and booleans; formulas give their saved value. Enough for a
 * member list; no styles, dates as Excel stores them.
 */
export function readXlsx(data: ArrayBuffer): string[][] {
  const files = unzipSync(new Uint8Array(data), {
    filter: (file) =>
      file.name === "xl/sharedStrings.xml" ||
      file.name === "xl/workbook.xml" ||
      file.name === "xl/_rels/workbook.xml.rels" ||
      file.name.startsWith("xl/worksheets/sheet"),
  })
  const xml = (name: string) =>
    files[name]
      ? new DOMParser().parseFromString(
          strFromU8(files[name]),
          "application/xml"
        )
      : null

  const shared = [
    ...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? []),
  ].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("")
  )

  // The first sheet in the workbook's order, found through its relationship.
  const firstId = xml("xl/workbook.xml")
    ?.getElementsByTagName("sheet")[0]
    ?.getAttribute("r:id")
  const target = [
    ...(xml("xl/_rels/workbook.xml.rels")?.getElementsByTagName(
      "Relationship"
    ) ?? []),
  ]
    .find((r) => r.getAttribute("Id") === firstId)
    ?.getAttribute("Target")
  const sheetPath = target
    ? `xl/${target.replace(/^\/?xl\//, "")}`
    : Object.keys(files).find((n) => n.startsWith("xl/worksheets/sheet"))
  const sheet = sheetPath ? xml(sheetPath) : null
  if (!sheet) throw new Error("No worksheet found in that file.")

  const column = (ref: string) => {
    let n = 0
    for (const ch of ref.replace(/\d+$/, ""))
      n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }
  const rows: string[][] = []
  for (const row of sheet.getElementsByTagName("row")) {
    const cells: string[] = []
    for (const c of row.getElementsByTagName("c")) {
      const type = c.getAttribute("t")
      const value = c.getElementsByTagName("v")[0]?.textContent ?? ""
      const text =
        type === "s"
          ? (shared[Number(value)] ?? "")
          : type === "inlineStr"
            ? [...c.getElementsByTagName("t")]
                .map((t) => t.textContent ?? "")
                .join("")
            : type === "b"
              ? value === "1"
                ? "TRUE"
                : "FALSE"
              : value
      cells[column(c.getAttribute("r") ?? "A1")] = text
    }
    rows.push(Array.from(cells, (cell) => cell ?? ""))
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""))
}

/** Rows back to CSV text, so a spreadsheet goes through the same preview as a CSV. */
export function toCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell
        )
        .join(",")
    )
    .join("\n")
}
