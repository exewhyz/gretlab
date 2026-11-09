import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AssignmentWorkbench } from "@/features/assignments/components/assignment-workbench"
import { getCurrentUser } from "@/features/auth/current-user"

export const metadata: Metadata = {
  title: "Assignment problem",
  robots: { index: false },
}

export default async function AssignmentProblemPage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>
}) {
  const { slug, number } = await params
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=/assignments/${slug}/problems/${number}`)
  }
  return <AssignmentWorkbench slug={slug} number={number} />
}
