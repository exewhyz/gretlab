/*
 * Problem statements were first written as structured blocks (paragraphs and tables).
 * They're markdown now, so authors can style them freely. This turns the old blocks
 * into markdown.
 */

export interface LegacyStatement {
  statement: (string | string[][])[]
  inputFormat: string[]
  outputFormat: string[]
  constraints: string[]
}

/** Escapes markdown outside `code` spans, so old plain text reads exactly as before. */
function escapeText(text: string) {
  return (
    text
      .split(/(`[^`]*`)/)
      .map((part, i) =>
        i % 2 ? part : part.replace(/([\\*_[\]<>|~])/g, "\\$1")
      )
      .join("")
      // Line starts that markdown would read as a heading, list or quote.
      .replace(/^(\s*)([#>+-]|\d+[.)])(\s)/gm, "$1\\$2$3")
  )
}

function table(rows: string[][]) {
  const [head = [], ...body] = rows
  const width = Math.max(...rows.map((row) => row.length))
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => escapeText(row[i] ?? "")).join(" | ")} |`
  return [line(head), `|${" --- |".repeat(width)}`, ...body.map(line)].join(
    "\n"
  )
}

/**
 * The old statement blocks as markdown. Input format, output format and constraints
 * stay separate fields: they're the problem's structure, not part of its story.
 */
export function statementToMarkdown(statement: LegacyStatement["statement"]) {
  return statement
    .map((block) =>
      typeof block === "string" ? escapeText(block) : table(block)
    )
    .join("\n\n")
}
