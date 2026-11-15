import { absolute, type Site } from "./config"
import { clip, plainText } from "./text"

/*
 * Structured data (schema.org JSON-LD): what the site is, who publishes it, and what a page
 * holds, for search results' names, breadcrumbs and rich results. Builders return plain
 * objects; <JsonLd> renders one safely.
 */

/** A script tag of structured data, with `<` escaped so a value can never close it. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  )
}

const orgId = (site: Site) => `${site.url}/#organization`
const websiteId = (site: Site) => `${site.url}/#website`

/** Who publishes the site and what it is: on every page, from the root layout. */
export function siteIdentity(site: Site) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId(site),
        name: site.name,
        url: site.url,
        logo: absolute(site, "/logo.png"),
        sameAs: [site.docsUrl],
      },
      {
        "@type": "WebSite",
        "@id": websiteId(site),
        name: site.name,
        url: site.url,
        description: site.description,
        inLanguage: "en",
        publisher: { "@id": orgId(site) },
      },
    ],
  }
}

/** A trail of pages, for search results' breadcrumbs. */
export function breadcrumbs(site: Site, items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absolute(site, item.path),
    })),
  }
}

/** A topic page: a collection of practice problems, listed in order, with where it sits. */
export function topicData(
  site: Site,
  topic: { slug: string; name: string },
  problems: { slug: string; title: string }[]
) {
  const path = `/problems/topics/${topic.slug}`
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${absolute(site, path)}#page`,
        name: `${topic.name} coding problems`,
        url: absolute(site, path),
        inLanguage: "en",
        isPartOf: { "@id": websiteId(site) },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: problems.length,
          itemListElement: problems.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: absolute(site, `/problems/${p.slug}`),
            name: p.title,
          })),
        },
      },
      breadcrumbs(site, [
        { name: "Problems", path: "/problems" },
        { name: "Topics", path: "/problems/topics" },
        { name: topic.name, path },
      ]),
    ],
  }
}

/** A practice problem: a free learning resource, with where it sits. */
export function problemData(
  site: Site,
  problem: {
  id: string
  title: string
  level: string
  unit: string
  description: string
  tags: { name: string }[]
  }
) {
  const path = `/problems/${problem.id}`
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "LearningResource",
        "@id": `${absolute(site, path)}#problem`,
        name: problem.title,
        description: clip(plainText(problem.description), 300),
        url: absolute(site, path),
        learningResourceType: "Practice problem",
        educationalLevel: problem.level,
        teaches: problem.unit,
        keywords: problem.tags.map((t) => t.name).join(", "),
        inLanguage: "en",
        isAccessibleForFree: true,
        provider: { "@id": orgId(site) },
        isPartOf: { "@id": websiteId(site) },
      },
      breadcrumbs(site, [
        { name: "Problems", path: "/problems" },
        { name: problem.title, path },
      ]),
    ],
  }
}
