import { getDb, organizations, sql } from "@workspace/db"

import { imageBytes } from "@/features/uploads/server"

const { eq } = sql

/**
 * An organization's logo (its bytes) and colour, for its PDFs (lib/pdf/document.ts embedBrand).
 * Called by routes that have already checked the person may print the document.
 */
export async function pdfBrand(slug: string) {
  const [org] = await getDb()
    .select({ branding: organizations.branding })
    .from(organizations)
    .where(eq(organizations.slug, slug))
  if (!org) return null
  return {
    logo: org.branding.logo ? await imageBytes(org.branding.logo) : null,
    accent: org.branding.accent ?? null,
  }
}
