import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"

import { PageHeader } from "@/components/page-header"
import { levelLine, TopicPage } from "@/features/catalog/components/topics"
import { getTopic } from "@/features/catalog/topics"
import { getSettings } from "@/features/settings/server"
import { siteSettings } from "@/lib/seo/config"
import { publicMetadata } from "@/lib/seo/metadata"
import { JsonLd, topicData } from "@/lib/seo/structured-data"
import { languagesOf } from "@/lib/seo/text"

interface Props {
  params: Promise<{ topic: string }>
}

export const revalidate = 300

// Rendered on first visit, then cached. An empty list means builds need no database.
export function generateStaticParams() {
  return []
}

const load = cache(getTopic)

/** "Strings: 3 practice problems", and what they are, for search results. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { topic: slug } = await params
  const found = await load(slug)
  if (!found) return {}
  const { topic } = found
  return publicMetadata({
    title: `${topic.name}: ${topic.count} practice ${topic.count === 1 ? "problem" : "problems"}`,
    description: `Free ${topic.name.toLowerCase()} coding problems (${levelLine(topic.count, topic.levels).split(" · ")[1]}), solvable in ${languagesOf(null)} in your browser and checked against hidden tests.`,
    path: `/problems/topics/${topic.slug}`,
  })
}

export default async function Page({ params }: Props) {
  const { topic: slug } = await params
  const [settings, found, site] = await Promise.all([getSettings(), load(slug), siteSettings()])
  if (!settings["practice.enabled"]) redirect("/contests")
  if (!found) notFound()
  return (
    <div className="min-h-dvh">
      <JsonLd data={topicData(site, found.topic, found.problems)} />
      <PageHeader />
      <TopicPage
        topic={found.topic}
        problems={found.problems}
        others={found.others}
        languages={languagesOf(null)}
      />
    </div>
  )
}
