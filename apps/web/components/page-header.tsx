"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { ThemeToggle } from "@/components/theme-toggle"
import {
  AccountMenu,
  MobileNav,
  ModeToggle,
  PrimaryNav,
} from "@/features/account/account-menu"
import { ScopeSwitcher } from "@/features/account/scope-switcher"
import { useViewer } from "@/features/account/use-viewer"
import { Brand } from "@/features/lab/components/brand"
import { ExamHeader, useExamLock } from "@/features/exams/components/exam-lock"
import { NotificationBell } from "@/features/notifications/components/bell"

const DEFAULT_TITLE = "Python Practice Lab"

/** The one header used on every page. `children` sit after the main sections. */
export function PageHeader({ children }: { children?: ReactNode }) {
  const { data: viewer } = useViewer()
  const exam = useExamLock()
  // During an exam sitting nothing leads away from it.
  if (exam) return <ExamHeader exam={exam} />

  const mustEnroll = viewer?.user?.security.mustEnroll
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 flex-none items-center gap-2 border-b border-hairline bg-canvas px-4 sm:gap-3">
        <Link href="/" className="mr-2 min-w-0 shrink">
          <Brand title={viewer?.siteTitle ?? DEFAULT_TITLE} />
        </Link>
        <ScopeSwitcher />
        <ModeToggle />
        <PrimaryNav />
        {children}
        <span className="flex-1" />
        <NotificationBell />
        <ThemeToggle />
        <AccountMenu />
        <MobileNav />
      </header>
      {mustEnroll && (
        <div
          role="alert"
          data-testid="two-factor-required"
          className="border-b border-hairline bg-destructive/10 px-4 py-2 text-body-sm text-ink"
        >
          Your account needs two-factor sign-in before you can carry on.{" "}
          <Link
            href="/account/security"
            className="font-medium underline underline-offset-2"
          >
            Turn it on
          </Link>
        </div>
      )}
    </>
  )
}
