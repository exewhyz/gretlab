/**
 * An organization's branding (apps/web/features/orgs/branding.ts): its logo and one brand colour,
 * which takes the place of GretLab's orange on its pages, certificates and PDFs. The colour must
 * stand out at least 3:1 (WCAG's minimum for controls) on both the light and the dark page, so
 * buttons and the current page stay visible in either theme.
 */
import { z } from "zod"

/** The page backgrounds the colour sits on (packages/ui globals.css --canvas). */
export const CANVAS = { light: "#f7f7f4", dark: "#171612" } as const
const INK = "#26251e"
const WHITE = "#ffffff"
/** WCAG 2's minimum for parts of controls. */
export const MIN_ACCENT_CONTRAST = 3

const HEX = /^#[0-9a-f]{6}$/i

export const brandingSchema = z.object({
  accent: z
    .string()
    .regex(HEX, "A colour like #2F6FDE")
    .transform((s) => s.toLowerCase())
    .nullable(),
})

export interface Branding {
  /** An uploaded image's id (PNG or JPEG). */
  logo?: string | null
  accent?: string | null
}

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  ) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/** Why a brand colour can't be used, or null when it can. */
export function accentProblem(hex: string): string | null {
  if (!HEX.test(hex)) return "Use a colour like #2F6FDE."
  if (contrast(hex, CANVAS.light) < MIN_ACCENT_CONTRAST)
    return "That colour is too light to see on the light page. Choose a darker shade."
  if (contrast(hex, CANVAS.dark) < MIN_ACCENT_CONTRAST)
    return "That colour is too dark to see in dark mode. Choose a lighter shade."
  return null
}

/** The text colour on top of the brand colour: white or ink, whichever contrasts more. */
export function onAccent(hex: string) {
  return contrast(hex, WHITE) >= contrast(hex, INK) ? WHITE : INK
}

/** The colour mixed toward black, for the pressed state. */
function darker(hex: string, amount = 0.15) {
  return `#${channels(hex)
    .map((c) =>
      Math.round(c * (1 - amount) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

/** The CSS variables a page sets to wear the brand colour in place of GretLab's. */
export function accentVars(hex: string): Record<string, string> {
  const text = onAccent(hex)
  return {
    "--primary": hex,
    "--primary-foreground": text,
    "--primary-active": darker(hex),
    "--sidebar-primary": hex,
    "--sidebar-primary-foreground": text,
  }
}
