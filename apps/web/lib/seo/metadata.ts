import type { Metadata } from "next"

import { PAGES, siteSettings, type PageKey } from "./config"

/*
 * Page metadata from the SEO config: a page names its entry, and this adds the canonical
 * link, share data and the X card the same way everywhere. A page's openGraph replaces the
 * layout's whole in Next.js, so the site's name and locale are repeated here.
 */

/** The site-wide defaults, for the root layout: name, address, verification, indexing. */
export async function siteMetadata(): Promise<Metadata> {
  const site = await siteSettings()
  return {
    metadataBase: new URL(site.url),
    title: { default: `${site.name}: ${site.tagline.toLowerCase()}`, template: `%s · ${site.name}` },
    description: site.description,
    applicationName: site.name,
    openGraph: {
      type: "website",
      siteName: site.name,
      locale: site.locale,
      title: site.name,
      description: site.description,
    },
    twitter: { card: "summary_large_image" },
    formatDetection: { telephone: false, email: false, address: false },
    // Switched off in the dashboard (a staging copy): no page may be indexed.
    ...(site.indexing ? {} : { robots: { index: false, follow: false } }),
    verification: {
      ...(site.googleVerification && { google: site.googleVerification }),
      ...(site.bingVerification && { other: { "msvalidate.01": site.bingVerification } }),
    },
  }
}

/** A public page's metadata, by its key in the config. */
export function pageMetadata(key: PageKey): Promise<Metadata> {
  const page = PAGES[key]
  return publicMetadata({ title: page.title, description: page.description, path: page.path })
}

/** Metadata for a public page whose title and description come from its data. */
export async function publicMetadata({
  title,
  description,
  path,
  type = "website",
  section,
  tags,
  keywords,
}: {
  title: string
  description: string
  path: string
  type?: "website" | "article"
  section?: string
  tags?: string[]
  keywords?: string[]
}): Promise<Metadata> {
  const site = await siteSettings()
  return {
    title,
    description,
    keywords,
    alternates: { canonical: path },
    openGraph: {
      type,
      siteName: site.name,
      locale: site.locale,
      url: path,
      title: `${title} · ${site.name}`,
      description,
      ...(type === "article" ? { section, tags } : {}),
    },
  }
}

/** A page that's someone's own, an organization's, or behind a sign-in: never in search. */
export function privateMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: true } }
}
