import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { MyOrganizations } from "@/features/orgs/components/public"

export const metadata: Metadata = { title: "Organizations" }

export default async function OrgsPage() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/orgs")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <MyOrganizations />
      </main>
    </div>
  )
}
