import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import type { ReactNode } from "react"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"

import { Toaster } from "@workspace/ui/components/sonner"

import { ProgressBar } from "@/components/progress-bar"
import { QueryProvider } from "@/components/query-provider"
import { StepUpDialog } from "@/components/step-up-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import { ADSENSE_CLIENT } from "@/features/ads/config"
import { ExamLockProvider } from "@/features/exams/components/exam-lock"
import { siteSettings } from "@/lib/seo/config"
import { siteMetadata } from "@/lib/seo/metadata"
import { JsonLd, siteIdentity } from "@/lib/seo/structured-data"

// Inter stands in for the design system's licensed CursorGothic.
const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans" })
const fontMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

// The site's name, address and defaults: Dashboard › Settings, read by lib/seo/config.ts.
export async function generateMetadata(): Promise<Metadata> {
  const base = await siteMetadata()
  return {
    ...base,
    // Lets AdSense verify site ownership before any ad unit exists.
    ...(ADSENSE_CLIENT && {
      other: { ...base.other, "google-adsense-account": ADSENSE_CLIENT },
    }),
  }
}

// Pages built ahead (builds have no database) pick up the dashboard's SEO settings within
// five minutes of a change.
export const revalidate = 300

export default async function RootLayout({
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
        {/* Who publishes the site and what it is, for search engines. */}
        <JsonLd data={siteIdentity(await siteSettings())} />
        <ThemeProvider>
          <QueryProvider>
            <ProgressBar />
            <ExamLockProvider>{children}</ExamLockProvider>
            <StepUpDialog />
            <Toaster position="bottom-right" closeButton />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
