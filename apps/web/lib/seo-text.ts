import { LANGUAGES } from "@workspace/judge"

/*
 * Turning a page's own content into the short text search results show: plain words from
 * markdown, cut at a word boundary. Pure, so pages and share images use the same rule.
 */

/** Markdown to plain text: code, images and markup dropped, links kept as their words. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** At most `max` characters, ending on a whole word with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const end = cut.lastIndexOf(" ")
  return `${(end > max * 0.6 ? cut.slice(0, end) : cut).replace(/[\s,;:.]+$/, "")}…`
}

/** "Python, JavaScript, C, C++ or Java": the languages a problem can be solved in (null: all). */
export function languagesOf(allowed: string[] | null) {
  const names = Object.entries(LANGUAGES)
    .filter(([id]) => !allowed || allowed.includes(id))
    .map(([, l]) => l.label.split(" ")[0]!)
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
    : (names[0] ?? "")
}
