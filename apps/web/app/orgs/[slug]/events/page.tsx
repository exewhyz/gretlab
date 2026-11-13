import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { EventsPage } from "@/features/events/components/events"
import { OrgShell } from "@/features/home/components/org-shell"

export const metadata: Metadata = { title: "Events", robots: { index: false } }

/** The organization's events: who's going, and creating them for those who run events. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/orgs/${slug}/events`)
  return (
    <OrgShell slug={slug}>
      <EventsPage slug={slug} />
    </OrgShell>
  )
}
