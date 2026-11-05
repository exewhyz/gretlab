/**
 * The site's whole ad policy lives in this file.
 *
 * - At most two ads on desktop and one on phones. Add a placement here only if
 *   that budget still holds.
 * - Never beside the editor, the Run buttons or test results: besides being
 *   distracting, ads next to controls invite accidental clicks, which AdSense
 *   penalizes.
 * - Only on public practice pages: never the dashboard, contests or privacy pages.
 * - No auto-refresh, popups, sticky or anchor units.
 *
 * Each placement is off until its slot id is set, so ads can be rolled out one
 * at a time and removed by deleting one environment variable.
 */
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT

export type AdPlacement = keyof typeof AD_PLACEMENTS

interface AdPlacementConfig {
  slot: string | undefined
  /**
   * When to show it, as Tailwind classes. A `display: none` slot never requests
   * an ad, because the viewport check in AdSlot can't fire for it.
   */
  visibility: string
  /** Reserved height, so the page doesn't jump when the ad arrives. */
  minHeight: number
  /** Fixed-size unit. Omit for a responsive one, which then needs `format`. */
  size?: { width: number; height: number }
  format?: "auto" | "horizontal"
}

export const AD_PLACEMENTS = {
  /** Under the question list. Skipped on short screens, where the list needs the room. */
  sidebar: {
    slot: process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR,
    visibility: "hidden [@media(min-width:901px)_and_(min-height:800px)]:block",
    minHeight: 200,
    size: { width: 200, height: 200 },
  },
  /** At the end of the problem, after the reference solution. */
  problemEnd: {
    slot: process.env.NEXT_PUBLIC_ADSENSE_SLOT_PROBLEM_END,
    visibility: "hidden min-[901px]:block",
    minHeight: 100,
    format: "horizontal",
  },
  /** Phones only, at the very bottom of the page, below the editor and its output. */
  pageEnd: {
    slot: process.env.NEXT_PUBLIC_ADSENSE_SLOT_PAGE_END,
    visibility: "block min-[901px]:hidden",
    minHeight: 100,
    format: "auto",
  },
} satisfies Record<string, AdPlacementConfig>

/** How long a slot must stay on screen before an ad is requested. */
export const AD_DWELL_MS = 1000
