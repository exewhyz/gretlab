import type { KeyboardEvent } from "react"

const INDENT = "    "

function replaceRange(
  area: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  caret?: number
) {
  area.setRangeText(text, start, end, "end")
  if (caret != null) area.selectionStart = area.selectionEnd = caret
  // Bubbling is what lets React's onChange see the edit.
  area.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Tab / Shift+Tab indenting, Python-aware Enter, and Ctrl/Cmd+Enter to run. */
export function handleEditorKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  onRun?: () => void
) {
  const area = event.currentTarget
  const { value, selectionStart: start, selectionEnd: end } = area
  const lineStart = value.lastIndexOf("\n", start - 1) + 1

  if (onRun && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault()
    onRun()
    return
  }

  if (event.key === "Tab") {
    event.preventDefault()
    if (event.shiftKey) {
      const nextBreak = value.indexOf("\n", lineStart)
      const lineEnd = nextBreak === -1 ? value.length : nextBreak
      const leading = value.slice(lineStart, lineEnd).match(/^ {1,4}/)
      if (leading) {
        replaceRange(
          area,
          lineStart,
          lineStart + leading[0].length,
          "",
          Math.max(lineStart, start - leading[0].length)
        )
      }
    } else if (start === end) {
      replaceRange(area, start, end, INDENT)
    } else {
      const indented = value.slice(lineStart, end).replace(/^/gm, INDENT)
      replaceRange(area, lineStart, end, indented)
      area.selectionStart = lineStart
      area.selectionEnd = lineStart + indented.length
    }
    return
  }

  const hasModifier =
    event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
  if (event.key === "Enter" && !hasModifier) {
    event.preventDefault()
    const before = value.slice(lineStart, start)
    let indent = before.match(/^[ \t]*/)?.[0] ?? ""
    if (/:\s*(#.*)?$/.test(before)) indent += INDENT
    replaceRange(area, start, end, `\n${indent}`)
  }
}
