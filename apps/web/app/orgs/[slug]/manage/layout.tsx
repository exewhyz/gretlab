import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { ManageShell } from "@/features/orgs/components/manage"

export default async function ManageLayout({
  children,
  params,
}: LayoutProps<"/orgs/[slug]/manage">) {
  const { slug } = await params
  // Permissions are checked by every API call this area makes; this only sends strangers to sign in.
  if (!(await getCurrentUser())) {
    redirect(`/sign-in?callbackUrl=/orgs/${slug}/manage`)
  }
  return <ManageShell slug={slug}>{children}</ManageShell>
}
