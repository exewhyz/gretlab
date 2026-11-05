import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { SubmissionDetailView } from "@/features/submissions/components/submission-view"

export const metadata: Metadata = {
  title: "Submission",
  robots: { index: false },
}

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/submissions/${id}`)}`)
  }
  // Who may read it is enforced by the API it fetches from.
  return <SubmissionDetailView id={id} />
}
