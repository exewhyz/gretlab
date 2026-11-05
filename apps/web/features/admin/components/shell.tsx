"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { PageHeader } from "@/components/page-header"
import { useViewer } from "@/features/account/use-viewer"

interface NavItem {
  href: string
  label: string
  adminOnly?: boolean
}

/** Grouped by the job a teacher is doing, so each page is easy to find. */
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "", items: [{ href: "/admin", label: "Overview" }] },
  {
    title: "Content",
    items: [
      { href: "/admin/problems", label: "Problems" },
      { href: "/admin/assignments", label: "Assignments" },
      { href: "/admin/contests", label: "Contests" },
      { href: "/admin/daily", label: "Daily challenge" },
      { href: "/admin/study-plans", label: "Study plans" },
      { href: "/admin/notes", label: "Notices" },
    ],
  },
  {
    title: "Students",
    items: [
      { href: "/admin/users", label: "Users", adminOnly: true },
      { href: "/admin/submissions", label: "Submissions" },
      { href: "/admin/integrity", label: "Plagiarism check" },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/admin/organizations", label: "Organizations", adminOnly: true },
      { href: "/admin/languages", label: "Languages" },
      { href: "/admin/settings", label: "Settings", adminOnly: true },
    ],
  },
]

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { data: viewer } = useViewer()
  const isAdmin = viewer?.user?.role === "admin"

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
              (item) => !item.adminOnly || isAdmin
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
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
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
