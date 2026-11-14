import { ImageResponse } from "next/og"

/*
 * The share card a link shows on WhatsApp, Slack, LinkedIn or X: Gretlab's look (DESIGN.md)
 * at 1200 × 630. Cream page, warm ink, one orange for the >>> mark, hairline rules.
 */

export const OG_SIZE = { width: 1200, height: 630 }

const CREAM = "#f7f7f4"
const INK = "#26251e"
const PENCIL = "#5a5852"
const RULE = "#e6e5e0"
const ORANGE = "#f54e00"

export function ogCard({
  eyebrow,
  title,
  lines = [],
  footer,
}: {
  /** A short label above the title ("Easy coding problem"). */
  eyebrow?: string
  title: string
  /** Up to two short lines under the title. */
  lines?: string[]
  /** The address shown at the bottom. */
  footer: string
}) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: CREAM,
        padding: "64px 72px",
        color: INK,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34 }}
      >
        <span style={{ color: ORANGE, fontWeight: 700, letterSpacing: -2 }}>
          {">>>"}
        </span>
        <span style={{ fontWeight: 600 }}>Gretlab</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {eyebrow && (
          <div style={{ display: "flex", fontSize: 28, color: PENCIL }}>
            {eyebrow}
          </div>
        )}
        <div
          style={{
            display: "flex",
            fontSize: title.length > 40 ? 64 : 76,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        {lines.slice(0, 2).map((line) => (
          <div
            key={line}
            style={{
              display: "flex",
              fontSize: 30,
              color: PENCIL,
              maxWidth: 1000,
            }}
          >
            {line}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          borderTop: `2px solid ${RULE}`,
          paddingTop: 24,
          fontSize: 26,
          color: PENCIL,
        }}
      >
        {footer}
      </div>
    </div>,
    OG_SIZE
  )
}
