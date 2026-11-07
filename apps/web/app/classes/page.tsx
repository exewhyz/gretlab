import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { MyClasses } from "@/features/classes/components/my-classes"

export const metadata: Metadata = {
  title: "My classes",
  robots: { index: false },
}

export default async function Page() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/classes")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <MyClasses />
      </main>
    </div>
  )
}
