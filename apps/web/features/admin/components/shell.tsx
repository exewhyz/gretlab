"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { PageHeader } from "@/components/page-header"
import type { PlatformPermission } from "@workspace/judge"

import { useViewer } from "@/features/account/use-viewer"

interface NavItem {
  href: string
  label: string
  /** Shown to people holding any of these; always shown without. */
  needs?: PlatformPermission[]
}

/** Grouped by the job a teacher is doing, so each page is easy to find. */
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "", items: [{ href: "/admin", label: "Overview" }] },
  {
    title: "Content",
    items: [
      { href: "/admin/library", label: "Library", needs: ["platform.library.manage"] },
      { href: "/admin/courses", label: "Courses", needs: ["platform.library.manage"] },
      { href: "/admin/problems", label: "Problems", needs: ["platform.library.manage"] },
      { href: "/admin/questions", label: "Questions", needs: ["platform.library.manage"] },
      { href: "/admin/units", label: "Units", needs: ["platform.library.manage"] },
      {
        href: "/admin/assignments",
        label: "Assignments",
        needs: ["platform.work.manage", "platform.gradebook.view"],
      },
      { href: "/admin/templates", label: "Templates", needs: ["platform.work.manage"] },
      { href: "/admin/contests", label: "Contests", needs: ["platform.work.manage"] },
      { href: "/admin/daily", label: "Daily challenge", needs: ["platform.library.manage"] },
      { href: "/admin/study-plans", label: "Study plans", needs: ["platform.library.manage"] },
      { href: "/admin/notes", label: "Notices", needs: ["platform.library.manage"] },
    ],
  },
  {
    title: "Students",
    items: [
      { href: "/admin/users", label: "Users", needs: ["platform.users.manage"] },
      { href: "/admin/submissions", label: "Submissions", needs: ["platform.submissions.view"] },
      { href: "/admin/integrity", label: "Plagiarism check", needs: ["platform.submissions.view"] },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/admin/organizations", label: "Organizations", needs: ["platform.orgs.manage"] },
      { href: "/admin/staff", label: "Staff and roles", needs: ["platform.roles.manage"] },
      { href: "/admin/activity", label: "Activity", needs: ["platform.audit.view"] },
      { href: "/admin/languages", label: "Languages", needs: ["platform.settings.manage"] },
      { href: "/admin/notifications", label: "Notifications", needs: ["platform.settings.manage"] },
      { href: "/admin/settings", label: "Settings", needs: ["platform.settings.manage"] },
    ],
  },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { data: viewer } = useViewer()
  const held = viewer?.user?.platform.permissions ?? []

  return (
    <div className="min-h-dvh">
      <PageHeader />
      <div className="grid gap-4 p-4 min-[901px]:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Dashboard"
          className="flex flex-wrap gap-x-1 gap-y-3 self-start min-[901px]:sticky min-[901px]:top-18 min-[901px]:grid"
        >
          {GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => !item.needs || item.needs.some((p) => held.includes(p))
            )
            if (items.length === 0) return null
            return (
              <div
                key={group.title}
                className="flex flex-wrap gap-1 min-[901px]:grid"
              >
                {group.title && (
                  <div className="hidden px-3 pb-0.5 text-caption-upper text-muted-foreground uppercase min-[901px]:block">
                    {group.title}
                  </div>
                )}
                {items.map((item) => {
                  const active =
                    item.href === "/admin"
                      ? pathname === item.href
                      : pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-sm px-3 py-1.5 text-nav text-body hover:bg-muted hover:text-ink",
                        active && "bg-muted text-ink"
                      )}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}

export function PageTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-display-sm text-ink">{children}</h1>
      {action}
    </div>
  )
}

export function Card({
  children,
  className,
  ...rest
}: {
  children: ReactNode
  className?: string
  /** For tests to find it. */
  "data-testid"?: string
}) {
  return (
    <div
      {...rest}
      className={cn(
        "rounded-lg border border-hairline bg-card p-5 text-body-sm text-body",
        className
      )}
    >
      {children}
    </div>
  )
}

export function Table({
  headers,
  children,
}: {
  headers: string[]
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
      <table className="w-full text-left text-body-sm text-ink">
        <thead>
          <tr className="border-b border-hairline text-caption-upper text-body uppercase">
            {/* Keyed by position: headers can repeat or be blank. */}
            {headers.map((header, index) => (
              <th key={index} className="px-3 py-2.5 whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-t [&_td]:border-hairline-soft [&_td]:px-3 [&_td]:py-2">
          {children}
        </tbody>
      </table>
    </div>
  )
}

export function Loading({ error }: { error?: Error | null }) {
  return error ? (
    <p role="alert" className="text-body-sm text-destructive">
      {error.message}
    </p>
  ) : (
    <p className="text-body-sm text-body">Loading…</p>
  )
}
