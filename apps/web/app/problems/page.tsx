import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ProblemLibrary } from "@/features/catalog/components/problem-library"
import { getCatalog } from "@/features/catalog/server"
import { getSettings } from "@/features/settings/server"

export const metadata: Metadata = {
  title: "Problems",
  description: "Practice programming problems by topic and difficulty.",
}

export const revalidate = 60

export default async function ProblemsPage() {
  const settings = await getSettings()
  if (!settings["practice.enabled"]) redirect("/contests")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <ProblemLibrary initial={await getCatalog()} />
    </div>
  )
}
