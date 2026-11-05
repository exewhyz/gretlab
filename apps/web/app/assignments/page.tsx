import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AssignmentList } from "@/features/assignments/components/assignments"
import { getCurrentUser } from "@/features/auth/current-user"

export const metadata: Metadata = {
  title: "Assignments",
  robots: { index: false },
}

export default async function AssignmentsPage() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/assignments")
  return <AssignmentList />
}
