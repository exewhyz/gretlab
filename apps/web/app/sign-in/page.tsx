import type { Metadata } from "next"
import Link from "next/link"

import { DEV_LOGIN_ENABLED } from "@/features/auth/options"
import { SignInForm } from "@/features/auth/sign-in-button"

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

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 text-body-sm text-body">
      <h1 className="text-display-lg text-ink">Sign in</h1>
      <p>
        Sign in to submit solutions, use every language and join contests. You
        can still practise Python without an account.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error === "AccessDenied"
            ? "This account can't sign in here. Registration may be closed, or limited to certain email addresses."
            : "Sign in didn't work. Please try again."}
        </p>
      )}
      <SignInForm
        callbackUrl={safePath(callbackUrl)}
        devLogin={DEV_LOGIN_ENABLED}
      />
      <Link href="/" className="underline underline-offset-2 hover:text-ink">
        Back to the problems
      </Link>
    </main>
  )
}
