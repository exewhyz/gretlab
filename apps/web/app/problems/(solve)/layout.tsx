import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AdScript } from "@/features/ads/ad-script"
import { AdSlot } from "@/features/ads/ad-slot"
import { PublishedWorkbench } from "@/features/lab/components/published-workbench"
import { CarryOverProgress } from "@/features/lab/components/carry-over-progress"
import {
  getGeneralNotices,
  listPublicProblems,
  movedSlugs,
} from "@/features/problems/server"
import { getSettings } from "@/features/settings/server"

// Public and cached, so crawlers and visitors get fast pages with the problem text in
// them. Saving from the dashboard refreshes this at once; see refreshPublicPages.
export const revalidate = 60

// A layout, so the question list and editor shell survive moving between questions.
export default async function QuestionsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [settings, questions, notices, moved] = await Promise.all([
    getSettings(),
    listPublicProblems(),
    getGeneralNotices(),
    movedSlugs(),
  ])
  if (!settings["practice.enabled"]) redirect("/contests")
  const ads = settings["ads.enabled"]

  return (
    <>
      {ads && <AdScript />}
      <CarryOverProgress moved={moved} />
      <PublishedWorkbench
        questions={questions}
        notices={notices.map(({ id, text }) => ({ id, text }))}
        sidebarAd={ads ? <AdSlot placement="sidebar" /> : undefined}
        pageEndAd={ads ? <AdSlot placement="pageEnd" /> : undefined}
      >
        {children}
      </PublishedWorkbench>
    </>
  )
}
