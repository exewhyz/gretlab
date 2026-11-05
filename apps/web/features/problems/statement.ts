import type { StatementBlock } from "@/features/lab/types"

/** Statement text to blocks: blank lines separate paragraphs, `|` rows are tables. */
export function parseStatement(text: string): StatementBlock[] {
  const blocks: StatementBlock[] = []
  for (const chunk of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((line) => line.trim())
    if (!lines.length) continue
    if (lines.every((line) => line.trim().startsWith("|"))) {
      blocks.push(
        lines
          .map((line) =>
            line
              .trim()
              .replace(/^\||\|$/g, "")
              .split("|")
              .map((cell) => cell.trim())
          )
          .filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)))
      )
    } else {
      blocks.push(lines.join(" "))
    }
  }
  return blocks
}

export function statementToText(blocks: StatementBlock[]): string {
  return blocks
    .map((block) =>
      typeof block === "string"
        ? block
        : block.map((row) => `| ${row.join(" | ")} |`).join("\n")
    )
    .join("\n\n")
}
