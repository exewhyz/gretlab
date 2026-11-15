import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { TopicIndex } from "@/features/catalog/components/topics"
import { listTopics } from "@/features/catalog/topics"
import { getSettings } from "@/features/settings/server"
import { siteSettings } from "@/lib/seo/config"
import { pageMetadata } from "@/lib/seo/metadata"
import { breadcrumbs, JsonLd } from "@/lib/seo/structured-data"
import { languagesOf } from "@/lib/seo/text"

// Title and description: lib/seo/config.ts. Refreshed with the library.
export const generateMetadata = (): Promise<Metadata> => pageMetadata("topics")
export const revalidate = 300

export default async function TopicsPage() {
  const [settings, topics, site] = await Promise.all([getSettings(), listTopics(), siteSettings()])
  if (!settings["practice.enabled"]) redirect("/contests")
  return (
    <div className="min-h-dvh">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          ...breadcrumbs(site, [
            { name: "Problems", path: "/problems" },
            { name: "Topics", path: "/problems/topics" },
          ]),
        }}
      />
      <PageHeader />
      <TopicIndex topics={topics} languages={languagesOf(null)} />
    </div>
  )
}
