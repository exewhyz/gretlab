import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { EventPage } from "@/features/events/components/events"
import { OrgShell } from "@/features/home/components/org-shell"

export const metadata: Metadata = { title: "Event", robots: { index: false } }

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/orgs/${slug}/events/${id}`)
  return (
    <OrgShell slug={slug}>
      <EventPage slug={slug} id={id} />
    </OrgShell>
  )
}
