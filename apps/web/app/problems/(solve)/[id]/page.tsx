import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { cache } from "react"

import { AdSlot } from "@/features/ads/ad-slot"
import { ProblemView } from "@/features/lab/components/problem-view"
import { getPublicProblem } from "@/features/problems/server"
import { getSettings } from "@/features/settings/server"
import { siteSettings } from "@/lib/seo/config"
import { publicMetadata } from "@/lib/seo/metadata"
import { JsonLd, problemData } from "@/lib/seo/structured-data"
import { clip, languagesOf, plainText } from "@/lib/seo/text"

interface QuestionPageProps {
  params: Promise<{ id: string }>
}

export const revalidate = 60

// Rendered on first visit, then cached. An empty list means builds need no database.
export function generateStaticParams() {
  return []
}

// The page and its metadata read the problem once per request.
const loadProblem = cache(getPublicProblem)

/**
 * What search results and link previews show for a problem: its title and difficulty, the
 * opening of its statement, and the languages it can be solved in (lib/seo builds the tags).
 */
export async function generateMetadata({
  params,
}: QuestionPageProps): Promise<Metadata> {
  const { id } = await params
  const problem = await loadProblem(id)
  if (!problem) return {}
  const tail = ` Solve it in ${languagesOf(problem.allowedLanguages)} and test it in your browser.`
  const opening =
    plainText(problem.description) ||
    `A ${problem.level} problem from ${problem.unit}.`
  return publicMetadata({
    title: `${problem.title}: ${problem.level} coding problem`,
    description: `${clip(opening, 158 - tail.length)}${tail}`,
    path: `/problems/${problem.id}`,
    type: "article",
    section: problem.unit,
    tags: problem.tags.map((t) => t.name),
    keywords: [problem.unit, ...problem.tags.map((t) => t.name)],
  })
}

export default async function QuestionPage({ params }: QuestionPageProps) {
  const { id } = await params
  const [question, settings, site] = await Promise.all([
    loadProblem(id),
    getSettings(),
    siteSettings(),
  ])
  if (!question) notFound()
  // An address the problem used to have (p2): one permanent redirect to its address now.
  if (question.id !== id) permanentRedirect(`/problems/${question.id}`)

  return (
    <>
      <JsonLd data={problemData(site, question)} />
      <ProblemView
        question={question}
        footer={
          settings["ads.enabled"] ? (
            <AdSlot placement="problemEnd" className="mt-6" />
          ) : undefined
        }
      />
    </>
  )
}
