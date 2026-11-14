import { getPublicProblem } from "@/features/problems/server"
import { OG_SIZE, ogCard } from "@/lib/og-card"
import { languagesOf } from "@/lib/seo-text"
import { SITE_URL } from "@/lib/site"

// A problem's share card: its title, difficulty and topic.
export const alt = "A coding problem on Gretlab"
export const size = OG_SIZE
export const contentType = "image/png"

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const problem = await getPublicProblem(id)
  const host = SITE_URL.replace(/^https?:\/\//, "")
  if (!problem)
    return ogCard({ title: "Coding problems", footer: `${host}/problems` })
  const level = problem.level.charAt(0).toUpperCase() + problem.level.slice(1)
  return ogCard({
    eyebrow: `${level} coding problem · ${problem.unit}`,
    title: problem.title,
    lines: [
      `Solve it in ${languagesOf(problem.allowedLanguages)}, in your browser.`,
    ],
    footer: `${host}/problems/${problem.id}`,
  })
}
