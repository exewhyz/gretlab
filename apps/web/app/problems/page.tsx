import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ProblemLibrary } from "@/features/catalog/components/problem-library"
import { getCatalog } from "@/features/catalog/server"
import { CarryOverProgress } from "@/features/lab/components/carry-over-progress"
import { movedSlugs } from "@/features/problems/server"
import { getSettings } from "@/features/settings/server"
import { pageMetadata } from "@/lib/seo/metadata"

// Title and description: lib/seo/config.ts.
export const generateMetadata = (): Promise<Metadata> => pageMetadata("problems")

export const revalidate = 60

export default async function ProblemsPage() {
  const settings = await getSettings()
  if (!settings["practice.enabled"]) redirect("/contests")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <CarryOverProgress moved={await movedSlugs()} />
      <ProblemLibrary initial={await getCatalog()} />
    </div>
  )
}
