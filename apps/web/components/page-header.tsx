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

const DEFAULT_TITLE = "Python Practice Lab"

/** The one header used on every page. `children` sit after the main sections. */
export function PageHeader({ children }: { children?: ReactNode }) {
  const { data: viewer } = useViewer()

  return (
    <header className="sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-hairline bg-canvas px-4">
      <Link href="/" className="mr-2 flex-none">
        <Brand title={viewer?.siteTitle ?? DEFAULT_TITLE} />
      </Link>
      <ScopeSwitcher />
      <ModeToggle />
      <PrimaryNav />
      {children}
      <span className="flex-1" />
      <ThemeToggle />
      <AccountMenu />
      <MobileNav />
    </header>
  )
}
