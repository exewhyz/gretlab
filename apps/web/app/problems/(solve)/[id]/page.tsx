import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { cache } from "react"

import { AdSlot } from "@/features/ads/ad-slot"
import { ProblemView } from "@/features/lab/components/problem-view"
import { getPublicProblem } from "@/features/problems/server"
import { getSettings } from "@/features/settings/server"
import { clip, languagesOf, plainText } from "@/lib/seo-text"
import { SITE_NAME, SITE_URL, absolute, jsonLd } from "@/lib/site"

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
 * What search results and link previews show for a problem: its own title and difficulty,
 * the opening of its statement, and the languages it can be solved in.
 */
export async function generateMetadata({
  params,
}: QuestionPageProps): Promise<Metadata> {
  const { id } = await params
  const problem = await loadProblem(id)
  if (!problem) return {}
  const level = problem.level.charAt(0).toUpperCase() + problem.level.slice(1)
  const title = `${problem.title}: ${problem.level} coding problem`
  const languages = languagesOf(problem.allowedLanguages)
  const tail = ` Solve it in ${languages} and test it in your browser.`
  const description = `${clip(plainText(problem.description) || `A ${problem.level} problem from ${problem.unit}.`, 158 - tail.length)}${tail}`
  return {
    title,
    description,
    alternates: { canonical: `/problems/${problem.id}` },
    keywords: [
      problem.unit,
      ...problem.tags.map((t) => t.name),
      `${level} coding problem`,
    ],
    // A page's openGraph replaces the layout's whole, so the site's name and locale repeat.
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      locale: "en_IN",
      url: `/problems/${problem.id}`,
      title: `${problem.title} · ${level} coding problem`,
      description,
      section: problem.unit,
      tags: problem.tags.map((t) => t.name),
    },
  }
}

/** The problem as schema.org data: a free practice resource, and where it sits. */
function problemJsonLd(
  problem: NonNullable<Awaited<ReturnType<typeof getPublicProblem>>>
) {
  const url = absolute(`/problems/${problem.id}`)
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "LearningResource",
        "@id": `${url}#problem`,
        name: problem.title,
        description: clip(plainText(problem.description), 300),
        url,
        learningResourceType: "Practice problem",
        educationalLevel: problem.level,
        teaches: problem.unit,
        keywords: problem.tags.map((t) => t.name).join(", "),
        inLanguage: "en",
        isAccessibleForFree: true,
        provider: { "@id": `${SITE_URL}/#organization` },
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Problems",
            item: absolute("/problems"),
          },
          { "@type": "ListItem", position: 2, name: problem.title, item: url },
        ],
      },
    ],
  }
}

export default async function QuestionPage({ params }: QuestionPageProps) {
  const { id } = await params
  const [question, settings] = await Promise.all([
    loadProblem(id),
    getSettings(),
  ])
  if (!question) notFound()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(problemJsonLd(question)) }}
      />
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
