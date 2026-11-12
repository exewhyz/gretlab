"use client"

import {
  BellRingingIcon,
  BooksIcon,
  BuildingsIcon,
  CalendarStarIcon,
  ChalkboardIcon,
  ClipboardTextIcon,
  CodeIcon,
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
        needs: ["platform.library.manage"],
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
        needs: ["platform.library.manage"],
      },
      {
        href: "/admin/questions",
        icon: QuestionIcon,
        label: "Questions",
        needs: ["platform.library.manage"],
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

export function Table({
  headers,
  children,
}: {
  headers: string[]
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
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
        <tbody className="[&_td]:border-t [&_td]:border-hairline-soft [&_td]:px-3 [&_td]:py-2.5 [&_tr]:transition-colors [&_tr:hover]:bg-muted/40">
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
    <div className="grid gap-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
