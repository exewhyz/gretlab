import { host, siteSettings } from "@/lib/seo/config"
import { OG_SIZE, ogCard } from "@/lib/seo/og-card"

// The share card for every page that doesn't have its own. Name, tagline and address come
// from Dashboard › Settings.
export const alt = "GretLab: coding practice, graded work and contests, with the school day around them"
export const size = OG_SIZE
export const contentType = "image/png"
export const revalidate = 300

export default async function Image() {
  const site = await siteSettings()
  return ogCard({
    site: site.name,
    title: site.tagline,
    lines: ["Practice, assignments, lab exams and contests, judged in a sandbox and graded automatically."],
    footer: host(site),
    editor: true,
  })
}
