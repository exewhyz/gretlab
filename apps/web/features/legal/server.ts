import { getSettings } from "@/features/settings/server"
import { DEFAULT_SITE, siteSettings } from "@/lib/seo/config"

/*
 * The facts the privacy policy and terms state about whoever runs this copy of GretLab:
 * Dashboard › Settings › Legal, plus the site's name and address. The wording lives with
 * each document (components/privacy-policy.tsx, components/terms.tsx); when it changes,
 * change LEGAL_UPDATED.
 */

/** When the privacy policy and terms were last changed (YYYY-MM-DD). */
export const LEGAL_UPDATED = "2026-11-26"

export interface LegalFacts {
  site: string
  url: string
  /** Who runs the site: the operator setting, or the site's name. */
  operator: string
  email: string
  grievanceOfficer: string
  address: string
  jurisdiction: string
  updated: string
}

export async function legalFacts(): Promise<LegalFacts> {
  const site = await siteSettings()
  let s: Awaited<ReturnType<typeof getSettings>> | null = null
  try {
    s = await getSettings()
  } catch {
    // A build has no database: the built-in values stand until the page is rebuilt.
  }
  return {
    site: site.name,
    url: site.url || DEFAULT_SITE.url,
    operator: s?.["legal.operator"] || site.name,
    email: s?.["legal.email"] ?? "",
    grievanceOfficer: s?.["legal.grievance_officer"] ?? "",
    address: s?.["legal.address"] ?? "",
    jurisdiction: s?.["legal.jurisdiction"] || "India",
    updated: LEGAL_UPDATED,
  }
}
