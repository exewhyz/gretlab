import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import type { ReactNode } from "react"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"

import { QueryProvider } from "@/components/query-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { ADSENSE_CLIENT } from "@/features/ads/config"
import { ExamLockProvider } from "@/features/exams/components/exam-lock"
import {
  DOCS_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  jsonLd,
} from "@/lib/site"

// Who publishes the site and what it is, once for every page (schema.org Organization and
// WebSite); search engines use it for the site's name and knowledge panel.
const identity = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      sameAs: [DOCS_URL],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
}

// Inter stands in for the design system's licensed CursorGothic.
const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  // Relative links in any page's metadata (canonical, share images) resolve against this.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}: the coding lab and the school day in one place`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_IN",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false, email: false, address: false },
  // Lets AdSense verify site ownership before any ad unit exists.
  ...(ADSENSE_CLIENT && {
    other: { "google-adsense-account": ADSENSE_CLIENT },
  }),
}

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        fontSans.variable,
        fontMono.variable
      )}
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(identity) }}
        />
        <ThemeProvider>
          <QueryProvider>
            <ExamLockProvider>{children}</ExamLockProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
