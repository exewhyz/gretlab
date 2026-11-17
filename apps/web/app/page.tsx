import type { Metadata } from "next"

import { getCurrentUser } from "@/features/auth/current-user"
import { Landing } from "@/features/landing/components/landing"
import { landingProof } from "@/features/landing/enquiries"
import { landingFacts } from "@/features/landing/server"
import { siteSettings } from "@/lib/seo/config"
import { JsonLd } from "@/lib/seo/structured-data"

export const dynamic = "force-dynamic"

/** The site's front page: the name and tagline, and the site's own share card. */
export async function generateMetadata(): Promise<Metadata> {
  const site = await siteSettings()
  const title = `${site.name}: ${site.tagline.toLowerCase()}`
  return {
    title: { absolute: title },
    description: site.description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: site.name, locale: site.locale, url: "/", title, description: site.description },
  }
}

/** The landing page (features/landing), for visitors and signed-in people alike. */
export default async function HomePage() {
  const [user, facts, site, proof] = await Promise.all([getCurrentUser(), landingFacts(), siteSettings(), landingProof()])
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: site.name,
          url: site.url,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          description: site.description,
          publisher: { "@id": `${site.url}/#organization` },
        }}
      />
      <Landing facts={facts} proof={proof} signedIn={!!user} />
    </>
  )
}
