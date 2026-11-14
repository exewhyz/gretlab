import { OG_SIZE, ogCard } from "@/lib/og-card"
import { SITE_URL } from "@/lib/site"

// The share card for every page that doesn't have its own.
export const alt = "Gretlab: the coding lab and the school day in one place"
export const size = OG_SIZE
export const contentType = "image/png"

export default function Image() {
  return ogCard({
    title: "The coding lab and the school day, in one place",
    lines: [
      "Attendance, timetables, leave, records, exams and report cards,",
      "with practice, assignments and lab exams judged in a sandbox.",
    ],
    footer: SITE_URL.replace(/^https?:\/\//, ""),
  })
}
