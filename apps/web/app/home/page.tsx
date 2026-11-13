import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { MemberHome } from "@/features/me/components/home"

export const metadata: Metadata = { title: "Home", robots: { index: false } }

/** A signed-in person's home across everything they belong to. */
export default async function Page() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/home")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <MemberHome />
      </main>
    </div>
  )
}
