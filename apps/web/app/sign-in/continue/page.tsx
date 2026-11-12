import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { readSession } from "@/features/auth/current-user"
import { SecondStep } from "@/features/auth/components/second-step"
import { stepOptions } from "@/features/auth/two-factor"

export const metadata: Metadata = { title: "Sign in", robots: { index: false } }

/** Only same-site paths, so a crafted link can't send someone elsewhere. */
function safePath(path: string | undefined) {
  return path?.startsWith("/") && !path.startsWith("//") ? path : "/"
}

/**
 * Where every sign-in lands: straight on to `next`, or first the second step for people
 * with two-factor sign-in on.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safePath((await searchParams).next)
  const session = await readSession()
  if (session.user) redirect(next)
  if (!session.pending)
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(next)}`)
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 text-body-sm text-body">
      <h1 className="text-display-lg text-ink">One more step</h1>
      <SecondStep
        email={session.pending.email}
        next={next}
        options={await stepOptions(session.pending)}
      />
    </main>
  )
}
