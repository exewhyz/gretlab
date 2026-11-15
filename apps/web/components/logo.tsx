/*
 * GretLab's mark: code braces holding a check. Code written, then judged and graded: the
 * Accepted verdict, the gradebook, the report card. Cream braces and a Signal Orange check
 * on a rounded ink tile; at 16px the orange check still reads. The same shapes draw the
 * favicon (app/icon.svg), the Apple icon, the share cards (lib/seo/og-card.tsx) and the
 * docs' logo.
 */

/** The shapes, in a 64-unit square. */
export const MARK = {
  /** The two braces (stroked). */
  braces:
    "M22 14c-5 0-6.5 2.5-6.5 6.5v5.5c0 3-1.5 5-4.5 6 3 1 4.5 3 4.5 6v5.5c0 4 1.5 6.5 6.5 6.5M42 14c5 0 6.5 2.5 6.5 6.5v5.5c0 3 1.5 5 4.5 6-3 1-4.5 3-4.5 6v5.5c0 4-1.5 6.5-6.5 6.5",
  /** The check between them (stroked, Signal Orange). */
  check: "M24.5 32.5l5.5 5.5 10-11",
  radius: 14,
  colors: { tile: "#26251e", braces: "#f7f7f4", check: "#f54e00" },
} as const

/**
 * The mark in the page: the tile takes the text colour (warm ink, light in dark mode), the
 * braces the page's colour, and the check stays Signal Orange in both themes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={className}>
      <rect width="64" height="64" rx={MARK.radius} fill="currentColor" />
      <path
        d={MARK.braces}
        fill="none"
        stroke="var(--background, #f7f7f4)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={MARK.check}
        fill="none"
        stroke="var(--primary, #f54e00)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The mark as a standalone SVG file's text, in its fixed colours (favicon, docs, logo files). */
export function markSvg() {
  const { tile, braces, check } = MARK.colors
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${MARK.radius}" fill="${tile}"/><path d="${MARK.braces}" fill="none" stroke="${braces}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="${MARK.check}" fill="none" stroke="${check}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}
