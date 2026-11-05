import { InlineCode } from "@/features/lab/components/inline-code"

/**
 * Staff-written prose: paragraphs separated by blank lines, `code` in backticks, and code
 * blocks fenced with ```. Rendered as text nodes only, so nothing in it can become markup.
 */
export function RichText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const parts = text.replace(/\r/g, "").split(/^```[^\n]*\n?/m)
  return (
    <div className={className}>
      {parts.map((part, index) =>
        index % 2 ? (
          <pre
            key={index}
            className="my-2 overflow-x-auto rounded-md border border-hairline bg-canvas-soft p-3 font-mono text-code text-ink"
          >
            {part.replace(/\n$/, "")}
          </pre>
        ) : (
          part
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.trim())
            .map((paragraph, p) => (
              <p key={`${index}-${p}`} className="my-2 whitespace-pre-line">
                <InlineCode text={paragraph.trim()} />
              </p>
            ))
        )
      )}
    </div>
  )
}
