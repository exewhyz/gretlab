import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { ProblemLibrary } from "@/features/catalog/components/problem-library"
import { getCatalog } from "@/features/catalog/server"
import { getSettings } from "@/features/settings/server"

export const metadata: Metadata = {
  title: "Coding problems",
  description:
    "Free programming practice problems by topic and difficulty, in Python, JavaScript, C, C++ and Java, with hints, editorials and a judge that runs your code in the browser.",
  alternates: { canonical: "/problems" },
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
