import type { MetadataRoute } from "next"

import { getDb, problems } from "@workspace/db"
import { sql } from "@workspace/db"

import { listTopics } from "@/features/catalog/topics"
import { isPublicProblem } from "@/features/problems/server"
import { absolute, siteSettings } from "@/lib/seo/config"
import { cached } from "@/lib/ttl-cache"

const { desc } = sql

// Built when asked (builds need no database), and the problem list kept for an hour.
export const dynamic = "force-dynamic"

/**
 * sitemap.xml: the public pages people can land on from a search: the problem library, every
 * public problem (with when it last changed), contests and the privacy page. Nothing behind a
 * sign-in, and no organization's or member's own pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [site, topics] = await Promise.all([siteSettings(), listTopics()])
  const rows = await cached("sitemap-problems", 60 * 60 * 1000, () =>
    getDb()
      .select({ slug: problems.slug, updatedAt: problems.updatedAt })
      .from(problems)
      .where(isPublicProblem)
      .orderBy(desc(problems.updatedAt))
  )
  const newest = rows[0]?.updatedAt ?? new Date()
  return [
    { url: absolute(site, "/"), lastModified: newest, changeFrequency: "weekly", priority: 1 },
    {
      url: absolute(site, "/problems"),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...rows.map((row) => ({
      url: absolute(site, `/problems/${row.slug}`),
      lastModified: row.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    {
      url: absolute(site, "/problems/topics"),
      lastModified: newest,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...topics.map((t) => ({
      url: absolute(site, `/problems/topics/${t.slug}`),
      lastModified: newest,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    { url: absolute(site, "/contests"), changeFrequency: "weekly", priority: 0.5 },
    { url: absolute(site, "/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absolute(site, "/terms"), changeFrequency: "yearly", priority: 0.2 },
  ]
}
