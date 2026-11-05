/** Renders text with `code` in backticks, the format used across content.json. */
export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, index) =>
        // Odd segments are the ones between backticks.
        index % 2 ? <code key={index}>{part}</code> : part
      )}
    </>
  )
}
