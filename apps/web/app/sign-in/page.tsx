import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { readSession } from "@/features/auth/current-user"

import { DEV_LOGIN_ENABLED } from "@/features/auth/options"
import { AuthCard } from "@/features/auth/components/auth-card"
import { SignInForm } from "@/features/auth/components/password-forms"

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
}

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}

/** Only same-site paths, so a crafted link can't send someone elsewhere. */
function safePath(path: string | undefined) {
  return path?.startsWith("/") && !path.startsWith("//") ? path : "/"
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl, error } = await searchParams
  // Signed in with Google but owing the second step: finish that instead.
  if ((await readSession()).pending) {
    redirect(`/sign-in/continue?next=${encodeURIComponent(safePath(callbackUrl))}`)
  }

  return (
    <AuthCard title="Sign in" intro="Welcome back. Sign in to practise, submit and join contests.">
      {error && (
        <p role="alert" className="text-destructive">
          {error === "AccessDenied"
            ? "This account can't sign in here. Registration may be closed, or limited to certain email addresses."
            : "Sign in didn't work. Please try again."}
        </p>
      )}
      <SignInForm callbackUrl={safePath(callbackUrl)} devLogin={DEV_LOGIN_ENABLED} />
    </AuthCard>
  )
}
