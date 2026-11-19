import { SETTINGS } from "@workspace/judge"

import { getSettings } from "@/features/settings/server"

/*
 * What search engines and link previews say about GretLab. Two kinds of fact live here:
 *
 * - The site's own, managed in Dashboard › Settings (Site title and the Search engines
 *   group): its name, address, description, tagline, whether it's indexed and the search
 *   consoles' verification codes. siteSettings() reads them.
 * - Each public page's title and description (PAGES below), kept with the code.
 *
 * The code that turns them into tags, structured data and share cards lives beside this
 * (metadata.ts, structured-data.tsx, og-card.tsx) and doesn't change when they do.
 */

export interface Site {
  name: string
  url: string
  description: string
  tagline: string
  indexing: boolean
  googleVerification: string
  bingVerification: string
  docsUrl: string
  locale: string
}

const DOCS_URL = "https://docs.gretlab.grettech.com"

/** The built-in values: what the settings start as, and what's used if they can't be read. */
export const DEFAULT_SITE: Site = {
  name: SETTINGS["site.title"].default,
  url: SETTINGS["seo.site_url"].default,
  description: SETTINGS["seo.description"].default,
  tagline: SETTINGS["seo.tagline"].default,
  indexing: SETTINGS["seo.indexing"].default,
  googleVerification: "",
  bingVerification: "",
  docsUrl: DOCS_URL,
  locale: "en_IN",
}

/**
 * The site's facts as the dashboard has them. A build has no database, so if settings can't
 * be read the built-in values are used; pages re-read them within minutes once running.
 */
export async function siteSettings(): Promise<Site> {
  try {
    const s = await getSettings()
    return {
      ...DEFAULT_SITE,
      name: s["site.title"],
      url: s["seo.site_url"].replace(/\/+$/, ""),
      description: s["seo.description"],
      tagline: s["seo.tagline"],
      indexing: s["seo.indexing"],
      googleVerification: s["seo.google_verification"],
      bingVerification: s["seo.bing_verification"],
    }
  } catch {
    return DEFAULT_SITE
  }
}

/** The public pages people can land on from a search: their title and description. */
export const PAGES = {
  problems: {
    path: "/problems",
    title: "Coding problems",
    description:
      "Free coding practice problems by topic and difficulty in Python, JavaScript, C, C++ and Java, with hints, editorials and a judge that checks every test.",
  },
  topics: {
    path: "/problems/topics",
    title: "Coding problems by topic",
    description:
      "Practice problems grouped by topic, from strings, lists and loops to functions and file handling, each from easy to hard and solvable in Python, JavaScript, C, C++ or Java.",
  },
  contests: {
    path: "/contests",
    title: "Coding contests",
    description:
      "Timed programming contests with ICPC or IOI scoring and a live scoreboard. Register, solve in Python, JavaScript, C, C++ or Java, and see how you rank.",
  },
  playground: {
    path: "/playground",
    title: "Code playground",
    description:
      "Write and run code with multiple files and no setup: Python and JavaScript right in your browser, and C, C++ and Java on a real compiler once you sign in.",
  },
  privacy: {
    path: "/privacy",
    title: "Privacy policy",
    description:
      "What GretLab keeps about you, why, who can see it, how long it's kept, and how to see, correct or delete your data.",
  },
  terms: {
    path: "/terms",
    title: "Terms of use",
    description:
      "The rules for using GretLab: your account and content, acceptable use, grades, exams and contests, and how disputes are handled.",
  },
} as const

export type PageKey = keyof typeof PAGES

/** An absolute address on the site. */
export const absolute = (site: Site, path: string) =>
  `${site.url}${path.startsWith("/") ? path : `/${path}`}`

/** The site's host, as shown on share cards: "gretlab.grettech.com". */
export const host = (site: Site) => site.url.replace(/^https?:\/\//, "")
