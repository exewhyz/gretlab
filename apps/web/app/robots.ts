import type { MetadataRoute } from "next"

import { absolute, siteSettings } from "@/lib/seo/config"

// Read when asked, so the dashboard's address and indexing switch apply at once.
export const dynamic = "force-dynamic"

/**
 * robots.txt: the whole public site may be crawled; the API is not a page. Private areas
 * (an organization's pages, the dashboard, a person's own pages) aren't blocked here: they
 * carry `noindex` themselves, which crawlers can only see if they're allowed to fetch them.
 * With indexing switched off in Dashboard › Settings (a staging copy), nothing may be crawled.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await siteSettings()
  if (!site.indexing) return { rules: { userAgent: "*", disallow: "/" } }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: absolute(site, "/sitemap.xml"),
    host: site.url,
  }
}
