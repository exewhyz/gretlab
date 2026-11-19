import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { privateMetadata } from "@/lib/seo/metadata"

import { PageHeader } from "@/components/page-header"
import { readSession } from "@/features/auth/current-user"
import { AccountPage } from "@/features/profile/components/account-page"

export const metadata: Metadata = privateMetadata("Security")

export default async function Page() {
  const session = await readSession()
  if (session.pending) redirect("/sign-in/continue?next=/account/security")
  if (!session.user) redirect("/sign-in?callbackUrl=/account/security")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <AccountPage tab="security" />
      </main>
    </div>
  )
}
