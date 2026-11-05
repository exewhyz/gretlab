import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { MySubmissionsPage } from "@/features/submissions/components/my-submissions"

export const metadata: Metadata = {
  title: "My submissions",
  robots: { index: false },
}

export default async function SubmissionsPage() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/submissions")
  return <MySubmissionsPage />
}
