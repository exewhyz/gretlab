"use client"

import { ErrorView } from "@/components/error-view"
import { ScrollX } from "@workspace/ui/components/scroll-x"
import { Button } from "@workspace/ui/components/button"
import {
  BellRingingIcon,
  BooksIcon,
  BuildingsIcon,
  CalendarStarIcon,
  ChalkboardIcon,
  ClipboardTextIcon,
  CodeIcon,
  EnvelopeSimpleIcon,
  FileCodeIcon,
  GearSixIcon,
  HouseIcon,
  KeyIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  NotebookIcon,
  PulseIcon,
  QuestionIcon,
  ShieldCheckIcon,
  ShapesIcon,
  SquaresFourIcon,
  StackIcon,
  TrophyIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { buttonVariants } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { AppFrame } from "@/components/app-frame"
import type { PlatformPermission } from "@workspace/judge"

import { useViewer } from "@/features/account/use-viewer"

interface NavItem {
  href: string
  label: string
  icon: Icon
  /** Shown to people holding any of these; always shown without. */
  needs?: PlatformPermission[]
}

/** Grouped by the job a teacher is doing, so each page is easy to find. */
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "",
    items: [{ href: "/admin", label: "Overview", icon: SquaresFourIcon }],
  },
  {
    title: "Content",
    items: [
      {
        href: "/admin/library",
        icon: BooksIcon,
        label: "Library",
        needs: ["platform.library.create", "platform.library.edit"],
      },
      {
        href: "/admin/courses",
        icon: ChalkboardIcon,
        label: "Courses",
        needs: ["platform.library.manage"],
      },
      {
        href: "/admin/problems",
        icon: CodeIcon,
        label: "Problems",
        needs: ["platform.library.create", "platform.library.edit"],
      },
      {
        href: "/admin/questions",
        icon: QuestionIcon,
        label: "Questions",
        needs: ["platform.library.create", "platform.library.edit"],
      },
      {
        href: "/admin/units",
        icon: StackIcon,
        label: "Units",
        needs: ["platform.library.manage"],
      },
      {
        href: "/admin/assignments",
        icon: ClipboardTextIcon,
        label: "Assignments",
        needs: ["platform.work.manage", "platform.gradebook.view"],
      },
      {
        href: "/admin/templates",
        icon: FileCodeIcon,
        label: "Templates",
        needs: ["platform.work.manage"],
      },
      {
        href: "/admin/contests",
        icon: TrophyIcon,
        label: "Contests",
        needs: ["platform.work.manage"],
      },
      {
        href: "/admin/daily",
        icon: CalendarStarIcon,
        label: "Daily challenge",
        needs: ["platform.library.manage"],
      },
      {
        href: "/admin/study-plans",
        icon: NotebookIcon,
        label: "Study plans",
        needs: ["platform.library.manage"],
      },
      {
        href: "/admin/notes",
        icon: MegaphoneIcon,
        label: "Notices",
        needs: ["platform.library.manage"],
      },
    ],
  },
  {
    title: "Students",
    items: [
      {
        href: "/admin/users",
        icon: UsersIcon,
        label: "Users",
        needs: ["platform.users.manage"],
      },
      {
        href: "/admin/submissions",
        icon: ListChecksIcon,
        label: "Submissions",
        needs: ["platform.submissions.view"],
      },
      {
        href: "/admin/integrity",
        icon: MagnifyingGlassIcon,
        label: "Plagiarism check",
        needs: ["platform.submissions.view"],
      },
    ],
  },
  {
    title: "Setup",
    items: [
      {
        href: "/admin/organizations",
        icon: BuildingsIcon,
        label: "Organizations",
        needs: ["platform.orgs.manage"],
      },
      {
        href: "/admin/kinds",
        icon: ShapesIcon,
        label: "Organization kinds",
        needs: ["platform.kinds.manage"],
      },
      {
        href: "/admin/staff",
        icon: KeyIcon,
        label: "Staff and roles",
        needs: ["platform.roles.manage"],
      },
      {
        href: "/admin/activity",
        icon: PulseIcon,
        label: "Activity",
        needs: ["platform.audit.view"],
      },
      {
        href: "/admin/languages",
        icon: CodeIcon,
        label: "Languages",
        needs: ["platform.languages.manage"],
      },
      {
        href: "/admin/notifications",
        icon: BellRingingIcon,
        label: "Notifications",
        needs: ["platform.notifications.manage"],
      },
      {
        href: "/admin/emails",
        icon: EnvelopeSimpleIcon,
        label: "Emails",
        needs: ["platform.emails.manage"],
      },
      {
        href: "/admin/settings",
        icon: GearSixIcon,
        label: "Settings",
        needs: ["platform.settings.manage"],
      },
    ],
  },
]

/**
 * The platform admin's frame: the same sidebar and header as a school (app-frame.tsx), with
 * the pages this person's platform role opens, grouped by the job being done.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { data: viewer } = useViewer()
  const held = viewer?.user?.platform.permissions ?? []
  const role =
    viewer?.user?.role === "admin"
      ? "Platform admin"
      : (viewer?.user?.platform.role ?? "Staff")
  const groups = GROUPS.map((g) => ({
    group: g.title,
    items: g.items
      .filter((item) => !item.needs || item.needs.some((p) => held.includes(p)))
      .map((item) => ({
        key: item.href,
        label: item.label,
        href: item.href,
        icon: item.icon,
      })),
  })).filter((g) => g.items.length > 0)
  return (
    <AppFrame
      brand={{
        mark: "GL",
        title: viewer ? "Platform" : undefined,
        subtitle: viewer ? role : undefined,
        href: "/admin",
        tooltip: "Platform",
      }}
      navLabel="Dashboard"
      loading={!viewer}
      groups={viewer ? groups : []}
      isActive={(href) =>
        href === "/admin"
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`)
      }
      title="Platform"
      badge={viewer ? role : undefined}
      headerExtra={
        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "hidden sm:inline-flex"
          )}
        >
          <HouseIcon /> Back to the site
        </Link>
      }
    >
      {children}
    </AppFrame>
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
      data-slot="card"
      className={cn(
        "rounded-xl bg-card p-5 text-body-sm text-body shadow-xs ring-1 ring-foreground/10",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * The figures above a list, in one line: each a number and what it counts, an optional
 * note, and a link to the rows behind it when there's a page for them. Not a row of tiles:
 * the list below is the point, and this is its summary.
 */
export function Stats({
  items,
  className,
}: {
  items: {
    label: string
    value: ReactNode
    hint?: ReactNode
    tone?: "bad" | "good"
    href?: string
  }[]
  className?: string
}) {
  return (
    <dl
      data-testid="stats"
      className={cn(
        "mb-4 flex flex-wrap gap-x-8 gap-y-3 border-y border-hairline py-3",
        className
      )}
    >
      {items.map((item) => {
        const body = (
          <>
            <dt className="text-caption text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                "text-title-md font-semibold text-ink tabular-nums",
                item.tone === "bad" && "text-destructive",
                item.tone === "good" && "text-success"
              )}
            >
              {item.value}
              {item.hint && (
                <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                  {item.hint}
                </span>
              )}
            </dd>
          </>
        )
        return item.href ? (
          <a
            key={item.label}
            href={item.href}
            className="grid gap-0.5 rounded-sm underline-offset-4 hover:[&_dd]:underline"
          >
            {body}
          </a>
        ) : (
          <div key={item.label} className="grid gap-0.5">
            {body}
          </div>
        )
      })}
    </dl>
  )
}

/** "1–100 of 340" with Previous and Next, under a paged list. Nothing when it fits on one page. */
export function Pager({
  page,
  pages,
  total,
  perPage = 100,
  onPage,
}: {
  page: number
  pages: number
  total: number
  perPage?: number
  onPage: (page: number) => void
}) {
  if (pages <= 1) return null
  return (
    <div
      className="mt-3 flex items-center justify-between gap-2 text-body-sm text-body"
      data-testid="pager"
    >
      <span className="tabular-nums">
        {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
      </span>
      <span className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </span>
    </div>
  )
}

/** A percentage as a short bar and its number, aligned in a table column. */
export function PercentBar({
  value,
  low = 40,
}: {
  /** 0 to 100, or null for nothing to show. */
  value: number | null
  /** Below this the bar is drawn as a concern. */
  low?: number
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  const v = Math.max(0, Math.min(100, value))
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span
        aria-hidden
        className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-strong"
      >
        <span
          className={cn(
            "block h-full rounded-full",
            v < low ? "bg-destructive" : "bg-ink/70"
          )}
          style={{ width: `${v}%` }}
        />
      </span>
      <span className="w-10 text-right">{Math.round(v)}%</span>
    </span>
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
    // Scrolls sideways in its own box on narrow screens, the first column (who or what
    // the row is) staying in view; the header's tint is opaque under the pinned cell.
    // Cells stay on one line (scroll, don't squeeze); a cell of prose sets data-wrap.
    <ScrollX
      pinFirst
      className="overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10 [--pin-head:color-mix(in_oklab,var(--muted)_40%,var(--card))]"
    >
      <table className="w-full text-left text-body-sm text-ink">
        <thead className="bg-muted/40">
          <tr className="border-b border-hairline text-caption font-medium text-muted-foreground">
            {/* Keyed by position: headers can repeat or be blank. */}
            {headers.map((header, index) => (
              <th key={index} className="px-3 py-2.5 whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-t [&_td]:border-hairline-soft [&_td]:px-3 [&_td]:py-2.5 [&_td:not([data-wrap])]:whitespace-nowrap [&_tr]:transition-colors [&_tr:hover]:bg-muted/40">
          {children}
        </tbody>
      </table>
    </ScrollX>
  )
}

export function Loading({ error }: { error?: Error | null }) {
  const status = (error as { status?: unknown } | null | undefined)?.status
  // Refused or missing: a page that says so, with a way back, not a red line.
  if (status === 403 || status === 404) return <ErrorView error={error} />
  return error ? (
    <p role="alert" className="text-body-sm text-destructive">
      {error.message}
    </p>
  ) : (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
