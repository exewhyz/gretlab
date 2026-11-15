import { ImageResponse } from "next/og"

import { MARK } from "@/components/logo"

/*
 * The share card a link shows on WhatsApp, Slack, LinkedIn or X, at 1200 × 630, in GretLab's
 * look (DESIGN.md): cream page, warm ink, hairline rules, one Signal Orange accent. The text
 * sits on the left; the site's card adds a small editor on the right with a graded result,
 * which is what GretLab does: code goes in, a verdict and a mark come out.
 */

export const OG_SIZE = { width: 1200, height: 630 }

const CREAM = "#f7f7f4"
const PAPER = "#fbfbf9"
const INK = "#26251e"
const PENCIL = "#5a5852"
const FAINT = "#a3a199"
const RULE = "#e6e5e0"
const ORANGE = "#f54e00"

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx={MARK.radius} fill={MARK.colors.tile} />
      <path
        d={MARK.braces}
        fill="none"
        stroke={MARK.colors.braces}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={MARK.check}
        fill="none"
        stroke={MARK.colors.check}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Lines of code drawn as bars (indent, width, colour): reads as code at a glance, in any font.
const CODE: [number, number, string][] = [
  [0, 150, ORANGE],
  [1, 210, INK],
  [1, 120, FAINT],
  [2, 180, INK],
  [2, 96, PENCIL],
  [1, 140, INK],
]

/** A small editor with a submission's result: the site's card only. */
function Editor() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 400,
        background: PAPER,
        border: `2px solid ${RULE}`,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 22px",
          borderBottom: `2px solid ${RULE}`,
          fontSize: 20,
          color: PENCIL,
        }}
      >
        <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: RULE }} />
        <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: RULE }} />
        <div style={{ display: "flex", marginLeft: 8 }}>solution.py</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "24px 22px" }}>
        {CODE.map(([indent, width, color], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", width: 18, fontSize: 16, color: FAINT }}>{i + 1}</div>
            <div
              style={{
                display: "flex",
                marginLeft: indent * 26,
                width,
                height: 12,
                borderRadius: 6,
                background: color,
                opacity: color === INK ? 0.85 : 1,
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 22px",
          borderTop: `2px solid ${RULE}`,
          background: CREAM,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24, fontWeight: 600 }}>
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="14" fill={ORANGE} />
            <path d="M8 14.5l4 4 8-9" fill="none" stroke={CREAM} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Accepted
        </div>
        <div style={{ display: "flex", fontSize: 20, color: PENCIL }}>12/12 tests · 10/10</div>
      </div>
    </div>
  )
}

export function ogCard({
  site,
  eyebrow,
  title,
  lines = [],
  footer,
  editor = false,
}: {
  /** The site's name, from Dashboard › Settings. */
  site: string
  /** A short label above the title ("Easy coding problem · Basics"). */
  eyebrow?: string
  title: string
  /** Up to two short lines under the title. */
  lines?: readonly string[]
  /** The address shown at the bottom. */
  footer: string
  /** Show the editor with a graded result on the right (the site's own card). */
  editor?: boolean
}) {
  const width = editor ? 600 : 1000
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: CREAM,
        padding: "60px 72px",
        color: INK,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flexGrow: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 36 }}>
          <Mark size={56} />
          <span style={{ fontWeight: 600, letterSpacing: -0.5 }}>{site}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {eyebrow && (
            <div style={{ display: "flex", fontSize: 26, color: ORANGE, fontWeight: 600 }}>
              {eyebrow}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize: title.length > 40 ? 58 : editor ? 64 : 76,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: -2,
              maxWidth: width,
            }}
          >
            {title}
          </div>
          {lines.slice(0, 2).map((line) => (
            <div key={line} style={{ display: "flex", fontSize: 28, color: PENCIL, maxWidth: width }}>
              {line}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            borderTop: `2px solid ${RULE}`,
            paddingTop: 22,
            fontSize: 24,
            color: PENCIL,
            maxWidth: width,
          }}
        >
          {footer}
        </div>
      </div>
      {editor && (
        <div style={{ display: "flex", alignItems: "center", marginLeft: 56 }}>
          <Editor />
        </div>
      )}
    </div>,
    OG_SIZE
  )
}
