/*
 * iCalendar (RFC 5545) for calendar feeds: escaping, line folding at 75 octets, UTC
 * times and CRLF line ends, so Google Calendar, Outlook and Apple Calendar read it. Pure.
 */

export interface CalendarEvent {
  /** Stable across updates, so subscribed calendars change an event instead of adding one. */
  uid: string
  title: string
  start: Date
  /** Defaults to start (a moment, like a due time). */
  end?: Date
  description?: string
  url?: string
}

/** Escapes TEXT values: backslash, semicolon, comma and line breaks. */
export function escapeText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

/** 20261110T093000Z */
export function icalTime(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

/** Folds a content line to 75 octets, continuing lines with a space; never splits a character. */
export function fold(line: string) {
  const encoder = new TextEncoder()
  const out: string[] = []
  let current = ""
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    const limit = out.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      out.push(current)
      current = ""
      size = 0
    }
    current += char
    size += bytes
  }
  out.push(current)
  return out.join("\r\n ")
}

export function buildCalendar(name: string, events: CalendarEvent[], now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gretlab//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    // Ask subscribed calendars to check back hourly.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ]
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(e.uid)}`,
      `DTSTAMP:${icalTime(now)}`,
      `DTSTART:${icalTime(e.start)}`,
      `DTEND:${icalTime(e.end ?? e.start)}`,
      `SUMMARY:${escapeText(e.title)}`
    )
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.url) lines.push(`URL:${e.url}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(fold).join("\r\n") + "\r\n"
}
