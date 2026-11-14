import type { MetadataRoute } from "next"

import { absolute } from "@/lib/site"

/**
 * robots.txt: the whole public site may be crawled; the API is not a page. Private areas
 * (an organization's pages, the dashboard, a person's own pages) aren't blocked here: they
 * carry `noindex` themselves, which crawlers can only see if they're allowed to fetch them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: absolute("/sitemap.xml"),
  }
}
