import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCalendar, escapeText, fold, icalTime } from "./ical.ts"

test("text is escaped", () => {
  assert.equal(escapeText("a;b,c\\d\nline"), "a\;b\\,c\\\\d\\nline")
})

test("times are UTC without separators", () => {
  assert.equal(icalTime(new Date("2026-11-10T09:30:05.123Z")), "20261110T093005Z")
})

test("long lines fold at 75 octets without splitting characters", () => {
  const long = "SUMMARY:" + "é".repeat(60)
  const folded = fold(long)
  for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75)
  assert.equal(folded.replace(/\r\n /g, ""), long)
})

test("a calendar with CRLF lines and one event per item", () => {
  const ics = buildCalendar(
    "My work",
    [
      { uid: "a@x", title: "Due: Week 1, loops", start: new Date("2026-11-10T18:29:00Z"), url: "https://x/a" },
      { uid: "b@x", title: "Exam", start: new Date("2026-11-11T04:00:00Z"), end: new Date("2026-11-11T06:00:00Z") },
    ],
    new Date("2026-11-01T00:00:00Z")
  )
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"))
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"))
  assert.equal(ics.split("BEGIN:VEVENT").length - 1, 2)
  assert.ok(ics.includes("SUMMARY:Due: Week 1\\, loops\r\n"))
  assert.ok(ics.includes("DTSTART:20261111T040000Z\r\nDTEND:20261111T060000Z"))
  assert.ok(!/[^\r]\n/.test(ics), "only CRLF line ends")
})
