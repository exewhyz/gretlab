import Link from "next/link"
import type { ReactNode } from "react"

import { LogoMark } from "@/components/logo"
import { LegalLinks } from "@/features/legal/components/legal-page"
import { HomeLink } from "@/components/home-link"

/**
 * The frame of the sign-in pages: the site's mark, a title, the form in a card, and links to
 * the privacy policy and terms. `agree` adds the line saying that continuing accepts them
 * (sign-in and sign-up, where an account can be made).
 */
export function AuthCard({
  title,
  intro,
  agree = false,
  children,
}: {
  title: string
  intro?: ReactNode
  agree?: boolean
  children: ReactNode
}) {
  const link = "text-ink underline underline-offset-2 hover:decoration-2"
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10 text-body-sm text-body">
      <div className="grid w-full max-w-sm gap-6">
        <HomeLink className="flex items-center gap-2.5 justify-self-center text-title-md font-semibold text-ink">
          <LogoMark className="size-8 shrink-0 text-ink" />
          GretLab
        </HomeLink>
        <div className="grid gap-5 rounded-2xl bg-card p-6 shadow-xs ring-1 ring-foreground/10 sm:p-8">
          <div className="grid gap-1.5 text-center">
            <h1 className="text-display-sm text-ink">{title}</h1>
            {intro && <p>{intro}</p>}
          </div>
          {children}
          {agree && (
            <p className="text-center text-caption text-muted-foreground">
              By continuing, you agree to the{" "}
              <Link href="/terms" className={link}>
                Terms of use
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className={link}>
                Privacy policy
              </Link>
              .
            </p>
          )}
        </div>
        <LegalLinks className="justify-self-center text-caption text-muted-foreground [&_a:hover]:text-ink" />
      </div>
    </main>
  )
}
