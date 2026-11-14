import type { Metadata } from "next"
import Link from "next/link"
import { orgPages } from "@/lib/paths"

export const metadata: Metadata = { title: "Course not linked yet", robots: { index: false } }

/** An LMS course opened Gretlab before an admin linked it to a class. */
export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams
  return (
    <main className="mx-auto grid min-h-dvh max-w-xl content-center gap-3 p-6">
      <h1 className="text-display-sm text-ink">You&apos;re signed in to Gretlab</h1>
      <p className="text-body-sm text-body" data-testid="lti-unlinked">
        This course hasn&apos;t been linked to a class in Gretlab yet, so there&apos;s nothing to open
        from it. Your college&apos;s admin links it under Manage › LMS; until then, your work is under
        Assignments.
      </p>
      <div className="flex gap-3 text-body-sm">
        <Link href="/assignments" className="underline underline-offset-2">
          Assignments
        </Link>
        {org && (
          <Link href={orgPages(org).home} className="underline underline-offset-2">
            Your college
          </Link>
        )}
      </div>
    </main>
  )
}
