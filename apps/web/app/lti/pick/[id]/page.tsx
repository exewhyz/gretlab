import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { DeepLinkPicker } from "@/features/lti/components/deep-link-picker"

export const metadata: Metadata = { title: "Add to your course", robots: { index: false } }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await getCurrentUser())) redirect(`/sign-in?callbackUrl=/lti/pick/${id}`)
  return (
    <main className="mx-auto max-w-3xl p-4">
      <DeepLinkPicker id={id} />
    </main>
  )
}
