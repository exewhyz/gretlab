import type { Branding } from "@workspace/judge"

/**
 * What a page shows of an organization's branding: its logo's address and its colour (null for
 * GretLab's own). Safe for anyone who may see the organization at all. Kept apart from
 * ./branding.ts, which changes it, so any page can call this without importing the org server.
 */
export function brandOf(org: { branding: Branding }) {
  return {
    logo: org.branding.logo ? `/api/v1/uploads/${org.branding.logo}` : null,
    accent: org.branding.accent ?? null,
  }
}
