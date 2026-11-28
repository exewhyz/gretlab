/**
 * SMS and WhatsApp to students and parents (the owner's decisions, 28 November 2026: Twilio,
 * from GretLab's account with a monthly allowance or an institution's own). Pure and
 * unit-tested; the signature check, which needs node:crypto, is in ./twilio.ts.
 */

/**
 * A phone number as E.164 ("+919876543210"), or null. Spaces, dashes, dots and brackets are
 * ignored; "00" means "+"; an Indian mobile may be written as 10 digits (6–9 first), with a
 * leading 0, or with 91 in front.
 */
export function normalizePhone(text: string): string | null {
  const raw = text.trim()
  if (!/^[+0-9 ().-]+$/.test(raw)) return null
  let digits = raw.replace(/[ ().-]/g, "")
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`
  if (digits.startsWith("+")) {
    const rest = digits.slice(1)
    return /^[1-9][0-9]{7,14}$/.test(rest) ? `+${rest}` : null
  }
  if (/^[6-9][0-9]{9}$/.test(digits)) return `+91${digits}`
  if (/^0[6-9][0-9]{9}$/.test(digits)) return `+91${digits.slice(1)}`
  if (/^91[6-9][0-9]{9}$/.test(digits)) return `+${digits}`
  return null
}

// The GSM 03.38 alphabet; characters in EXTENSION take two units.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM_EXTENSION = "^{}\\[~]|€\f"

/** How an SMS is sent and billed: GSM-7 at 160 a part (153 when split), else UCS-2 at 70 (67). */
export function smsSegments(text: string) {
  const chars = [...text]
  const gsm = chars.every((c) => GSM_BASIC.includes(c) || GSM_EXTENSION.includes(c))
  if (gsm) {
    const units = chars.reduce((n, c) => n + (GSM_EXTENSION.includes(c) ? 2 : 1), 0)
    return { encoding: "gsm" as const, units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) }
  }
  // UCS-2 counts UTF-16 code units (an emoji is two).
  const units = text.length
  return { encoding: "ucs2" as const, units, segments: units <= 70 ? 1 : Math.ceil(units / 67) }
}

/**
 * An SMS from its wording: {{placeholders}} filled in one pass (so a value is never read as
 * wording), spaces tidied, then cut with "..." to at most `maxSegments` parts.
 */
export function composeSms(template: string, values: Record<string, string>, maxSegments = 2) {
  const filled = template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => values[key] ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
  if (smsSegments(filled).segments <= maxSegments) return filled
  const chars = [...filled]
  // Shorten until it fits with the marker added.
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}...`
    if (smsSegments(candidate).segments <= maxSegments) lo = mid
    else hi = mid - 1
  }
  return `${chars.slice(0, lo).join("").trimEnd()}...`
}

/** What a failed send means: try again later, never send it, or the person opted out. */
export function messageFailure(f: {
  status: number | null
  code: number | null
}): "retry" | "permanent" | "opted_out" {
  // 21610: the recipient replied STOP.
  if (f.code === 21610) return "opted_out"
  if (f.status == null || f.status === 429 || f.status >= 500) return "retry"
  // A wrong or missing key is the operator's to fix; queued messages wait for it.
  if (f.status === 401 || f.status === 403) return "retry"
  return "permanent"
}

/** Messages an organization may still send this month from GretLab's account. */
export function allowanceLeft(a: { students: number; perStudent: number; used: number }) {
  return Math.max(0, a.students * a.perStudent - a.used)
}

/** Channels a message goes by. */
export const MESSAGE_CHANNELS = ["sms", "whatsapp"] as const
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number]
