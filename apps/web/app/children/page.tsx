import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { MyChildren } from "@/features/parents/components/children"

export const metadata: Metadata = {
  title: "My children",
  robots: { index: false },
}

export default async function Page() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/children")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <MyChildren />
      </main>
    </div>
  )
}
