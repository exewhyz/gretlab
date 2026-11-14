/*
 * The site's identity for search engines and link previews: one place for its name, its
 * address and its documentation, so titles, canonical links, the sitemap, robots.txt and
 * structured data all agree.
 */

/** The public address, from NEXTAUTH_URL (set in every deployment), without a trailing slash. */
export const SITE_URL = (
  process.env.NEXTAUTH_URL ?? "https://gretlab.grettech.com"
).replace(/\/+$/, "")

/** The product's name as people read it (the header's wordmark may style it). */
export const SITE_NAME = "Gretlab"

/** The documentation site. */
export const DOCS_URL = "https://docs.gretlab.grettech.com"

/** What Gretlab is, in one line: the default description and the share card's tagline. */
export const SITE_DESCRIPTION =
  "Gretlab runs a school, college or training program's day (attendance, timetables, leave, records, exams and report cards) with a coding lab built in: practice problems, graded assignments, lab exams and contests judged in a secure sandbox."

/** An absolute address for a path on this site. */
export const absolute = (path: string) =>
  `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`

/**
 * Structured data (JSON-LD) as a script's text, with `<` escaped so a value can never close
 * the tag (Next.js's JSON-LD guide).
 */
export const jsonLd = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c")
