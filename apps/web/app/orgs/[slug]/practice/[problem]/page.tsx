import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { OrgPracticeWorkbench } from "@/features/orgs/components/practice"

export const metadata: Metadata = {
  title: "Problem",
  robots: { index: false },
}

export default async function OrgPracticePage({
  params,
}: {
  params: Promise<{ slug: string; problem: string }>
}) {
  const { slug, problem } = await params
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/practice/${problem}`)
  }
  return <OrgPracticeWorkbench slug={slug} problem={problem} />
}
