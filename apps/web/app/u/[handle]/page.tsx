import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { ProfileView } from "@/features/catalog/components/profile"

export const metadata: Metadata = { title: "Profile", robots: { index: false } }

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/u/${handle}`)}`)
  }
  return <ProfileView handle={handle} />
}
