import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AssignmentView } from "@/features/assignments/components/assignments"
import { getCurrentUser } from "@/features/auth/current-user"

export const metadata: Metadata = {
  title: "Assignment",
  robots: { index: false },
}

export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=/assignments/${slug}`)
  }
  return <AssignmentView slug={slug} />
}
