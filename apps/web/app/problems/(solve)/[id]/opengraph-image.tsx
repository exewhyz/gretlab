import { getPublicProblem } from "@/features/problems/server"
import { host, siteSettings } from "@/lib/seo/config"
import { OG_SIZE, ogCard } from "@/lib/seo/og-card"
import { languagesOf } from "@/lib/seo/text"

// A problem's share card: its title, difficulty, topic and languages.
export const alt = "A coding problem on GretLab"
export const size = OG_SIZE
export const contentType = "image/png"

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [problem, site] = await Promise.all([getPublicProblem(id), siteSettings()])
  if (!problem)
    return ogCard({
      site: site.name,
      title: "Coding problems",
      footer: `${host(site)}/problems`,
    })
  const level = problem.level.charAt(0).toUpperCase() + problem.level.slice(1)
  return ogCard({
    site: site.name,
    eyebrow: `${level} coding problem · ${problem.unit}`,
    title: problem.title,
    lines: [
      `Solve it in ${languagesOf(problem.allowedLanguages)}, in your browser.`,
    ],
    footer: `${host(site)}/problems/${problem.id}`,
  })
}
