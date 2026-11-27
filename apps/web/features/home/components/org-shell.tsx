"use client"

import Link from "next/link"
import {
  AirplaneTiltIcon,
  ClipboardTextIcon,
  FingerprintIcon,
  BedIcon,
  BookOpenIcon,
  CurrencyInrIcon,
  BooksIcon,
  BusIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  CalendarXIcon,
  PlugsConnectedIcon,
  CalendarStarIcon,
  ChalkboardTeacherIcon,
  ChartBarIcon,
  CheckSquareIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  FileTextIcon,
  GearIcon,
  GraduationCapIcon,
  HeartIcon,
  HouseIcon,
  IdentificationBadgeIcon,
  LinkIcon,
  ListChecksIcon,
  MegaphoneIcon,
  ChatCircleTextIcon,
  ListNumbersIcon,
  PuzzlePieceIcon,
  QuestionIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  StackIcon,
  StudentIcon,
  ExamIcon,
  TargetIcon,
  TrendUpIcon,
  TrophyIcon,
  UploadSimpleIcon,
  UserIcon,
  UsersIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { accentVars, KINDS, ORG_NAV, visibleOrgNav } from "@workspace/judge"
import { usePathname } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import { AppFrame } from "@/components/app-frame"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { orgShell } from "@/features/home/server"

export type Shell = ApiResult<typeof orgShell>

export function useShell(slug: string) {
  return useQuery({
    queryKey: ["org", slug, "shell"],
    queryFn: () => api<Shell>(`/orgs/${slug}/shell`),
  })
}

/** The management pages (ORG_NAV keys) this person's sidebar opens here. */
function managedKeys(shell: Shell): Set<string> {
  return new Set(
    visibleOrgNav(ORG_NAV, {
      orgType: shell.org.type,
      can: (p) => shell.permissions.includes(p),
      canWholeOrg: (p) => shell.wholeOrg.includes(p),
      enabledModules: new Set(shell.modules),
      planFeatures: shell.planFeatures,
    }).flatMap((g) => g.items.map((i) => i.key))
  )
}

/**
 * What this person can open here, decided exactly as the sidebar decides it. Home cards,
 * shortcuts and checklists link to a management page only when `manages(key)` says so,
 * so no link leads to a page that refuses them or a module that's switched off.
 */
export function useOrgReach(slug: string) {
  const { data: shell } = useShell(slug)
  const keys = shell ? managedKeys(shell) : new Set<string>()
  return {
    ready: Boolean(shell),
    /** Holds this permission anywhere here. */
    may: (permission: string) =>
      (shell?.permissions as readonly string[] | undefined)?.includes(
        permission
      ) ?? false,
    /** This module is switched on. */
    has: (module: string) =>
      (shell?.modules as readonly string[] | undefined)?.includes(module) ??
      false,
    /** The sidebar opens this management page (an ORG_NAV key). */
    manages: (key: string) => keys.has(key),
  }
}

/** An icon for each sidebar item (by its ORG_NAV key, or our own keys). */
const ICONS: Record<string, Icon> = {
  home: HouseIcon,
  members: UsersIcon,
  groups: SquaresFourIcon,
  roles: ShieldCheckIcon,
  invites: LinkIcon,
  import: UploadSimpleIcon,
  parents: HeartIcon,
  students: StudentIcon,
  "academic-years": CalendarCheckIcon,
  exams: ExamIcon,
  results: ExamIcon,
  leave: AirplaneTiltIcon,
  "my-attendance": FingerprintIcon,
  admissions: ClipboardTextIcon,
  "staff-attendance": IdentificationBadgeIcon,
  subjects: BookOpenIcon,
  timetable: CalendarDotsIcon,
  "my-timetable": CalendarDotsIcon,
  holidays: CalendarXIcon,
  integrations: PlugsConnectedIcon,
  courses: StackIcon,
  outcomes: TargetIcon,
  training: SealCheckIcon,
  progress: TrendUpIcon,
  attendance: CheckSquareIcon,
  notices: MegaphoneIcon,
  books: BooksIcon,
  fees: CurrencyInrIcon,
  transport: BusIcon,
  hostel: BedIcon,
  assignments: CodeIcon,
  templates: FileTextIcon,
  contests: TrophyIcon,
  library: BooksIcon,
  problems: PuzzlePieceIcon,
  questions: QuestionIcon,
  reports: ChartBarIcon,
  "attendance-report": ListChecksIcon,
  activity: ClockCounterClockwiseIcon,
  notifications: MegaphoneIcon,
  settings: GearIcon,
  lms: GraduationCapIcon,
  classes: ChalkboardTeacherIcon,
  practice: PuzzlePieceIcon,
  "study-plans": ListNumbersIcon,
  feedback: ChatCircleTextIcon,
  "feedback-rounds": ChatCircleTextIcon,
  "my-feedback": ChatCircleTextIcon,
  child: UserIcon,
  profile: IdentificationBadgeIcon,
  events: CalendarStarIcon,
  "open-groups": UsersThreeIcon,
}

interface Item {
  key: string
  label: string
  href: string
  badge?: string
}

/** The sidebar for this person here: home, then what their roles and modules open. */
function navFor(shell: Shell): { group: string; items: Item[] }[] {
  const base = `/orgs/${shell.org.slug}`
  const groups: { group: string; items: Item[] }[] = [
    { group: "", items: [{ key: "home", label: "Home", href: base }] },
  ]
  // Staff: the management areas their permissions open.
  const managed = visibleOrgNav(ORG_NAV, {
    orgType: shell.org.type,
    can: (p) => shell.permissions.includes(p),
    canWholeOrg: (p) => shell.wholeOrg.includes(p),
    enabledModules: new Set(shell.modules),
    planFeatures: shell.planFeatures,
  })
  for (const g of managed) {
    const items = g.items
      .filter((i) => i.key !== "overview")
      .map((i) => ({
        key: i.key,
        label: i.label,
        href: `${base}/manage${i.path}`,
        badge:
          i.key === "members" && shell.pending
            ? String(shell.pending)
            : i.key === "admissions" && shell.admissionsNew
              ? String(shell.admissionsNew)
              : undefined,
      }))
    if (items.length) groups.push({ group: g.label, items })
  }
  // Students: their own pages.
  if (shell.views.includes("student")) {
    groups.push({
      group: "Learning",
      items: [
        {
          key: "classes",
          label: `My ${(shell.terms?.groups ?? "Classes").toLowerCase()}`,
          href: "/classes",
        },
        ...(shell.modules.includes("library")
          ? [{ key: "books", label: "Library", href: `${base}/books` }]
          : []),
        ...(shell.modules.includes("exams")
          ? [{ key: "results", label: "Results", href: `${base}/results/me` }]
          : []),
        ...(shell.modules.includes("subjects")
          ? [{ key: "feedback", label: "Feedback", href: `${base}/feedback` }]
          : []),
      ],
    })
    if (shell.modules.includes("coding"))
      groups.push({
        group: "Coding lab",
        items: [
          { key: "assignments", label: "Assignments", href: "/assignments" },
          { key: "practice", label: "Practice", href: "/problems" },
          {
            key: "study-plans",
            label: "Study plans",
            href: `${base}/study-plans`,
          },
          { key: "contests", label: "Contests", href: "/contests" },
        ],
      })
  }
  // Parents: each child.
  if (shell.views.includes("parent") && shell.children.length) {
    groups.push({
      group: "My children",
      items: shell.children.map((c) => ({
        key: "child",
        label: c.name,
        href: `${base}/children/${c.id}`,
      })),
    })
  }
  // Everyone: the school's profile, membership and what it shares with members.
  groups.push({
    group: `This ${shell.noun ?? "school"}`,
    items: [
      ...(KINDS[shell.org.type].openGroups
        ? [
            {
              key: "open-groups",
              // Next to the Groups page staff manage, this one says what it's for.
              label: managed.some((g) =>
                g.items.some((i) => i.key === "groups")
              )
                ? `Join ${(shell.terms?.groups ?? "groups").toLowerCase()}`
                : (shell.terms?.groups ?? "Groups"),
              href: `${base}/groups`,
            },
          ]
        : []),
      ...(shell.modules.includes("events")
        ? [{ key: "events", label: "Events", href: `${base}/events` }]
        : []),
      // Your own check-in, as its page decides: an active member holding a permission
      // (platform staff looking in aren't members).
      ...(shell.modules.includes("staffAttendance") &&
      shell.member &&
      shell.permissions.length > 0
        ? [
            {
              key: "my-attendance",
              label: "My attendance",
              href: `${base}/my-attendance`,
            },
          ]
        : []),
      ...(shell.modules.includes("leave")
        ? [
            {
              key: "leave",
              label: "Leave",
              href: `${base}/leave`,
              badge: shell.leavePending
                ? String(shell.leavePending)
                : undefined,
            },
          ]
        : []),
      {
        key: "profile",
        label: `About the ${shell.noun ?? "school"}`,
        href: `${base}/about`,
      },
    ],
  })
  return groups
}

/**
 * Wears the organization's brand colour in place of GretLab's while its pages are open: set on
 * the document, so dialogs, sheets and menus (rendered outside the frame) wear it too, and taken
 * off when leaving them.
 */
function useBrandColour(accent: string | null) {
  useEffect(() => {
    if (!accent) return
    const root = document.documentElement
    const vars = accentVars(accent)
    for (const [name, value] of Object.entries(vars))
      root.style.setProperty(name, value)
    root.dataset.brand = accent
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name)
      delete root.dataset.brand
    }
  }, [accent])
}

/**
 * The frame of every school page: a sidebar shaped by who you are here (full on laptops
 * and PCs, an icon rail on tablets, a slide-out menu on phones) and a header with the
 * school, your role, notifications, theme and account (components/app-frame.tsx).
 */
export function OrgShell({
  slug,
  children,
}: {
  slug: string
  children: ReactNode
}) {
  const { data: shell } = useShell(slug)
  useBrandColour(shell?.org.brand.accent ?? null)
  const pathname = usePathname()
  const groups = shell ? navFor(shell) : []
  const isActive = (href: string) =>
    href === `/orgs/${slug}`
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`)
  return (
    <AppFrame
      brand={{
        mark: (shell?.org.name ?? "·").slice(0, 2).toUpperCase(),
        logo: shell?.org.brand.logo,
        title: shell?.org.name,
        subtitle: shell
          ? `${shell.role}${!shell.org.active ? " · Suspended" : ""}`
          : undefined,
        href: orgPages(slug).home,
        tooltip: shell?.org.name ?? "School",
      }}
      navLabel="Organization"
      profileHref={shell?.hasProfile ? orgPages(slug).profile("me") : undefined}
      loading={!shell}
      groups={groups.map((g) => ({
        group: g.group,
        items: g.items.map((i) => ({
          ...i,
          icon: ICONS[i.key] ?? SquaresFourIcon,
        })),
      }))}
      isActive={isActive}
      title={shell?.org.name}
      badge={shell?.role}
    >
      {/* On the plan page itself the page says it, with what to do. */}
      {shell?.planNotice && !pathname.endsWith("/manage/billing") && (
        <PlanNotice slug={slug} notice={shell.planNotice} />
      )}
      {children}
    </AppFrame>
  )
}

const PLAN_NOTICE: Record<string, string> = {
  "limit:near":
    "Your plan is nearly full: 90% of its students or staff are in use.",
  "limit:over":
    "Your plan is over its limit. Everything works for 30 days; then adding people pauses.",
  "limit:paused":
    "Adding people is paused: the plan is over its limit and its 30 days are over.",
  "period:past_due":
    "Your plan is due. Pay within 7 days to keep adding people.",
  "period:paused":
    "Your plan is paused until it's paid. Everything else keeps working.",
  "renew:7":
    "Your plan renews within a week: pay from Plan and billing to keep everything going.",
  "renew:1":
    "Your plan ends tomorrow: pay today to keep adding people after it.",
}

/** A bar above every page for whoever manages billing, while the plan needs attention. */
function PlanNotice({ slug, notice }: { slug: string; notice: string }) {
  // The most pressing first: unpaid, then the limit, then a renewal coming up.
  const parts = notice.split("|")
  const pick =
    parts.find((p) => p.startsWith("period:")) ??
    parts.find((p) => p.startsWith("limit:")) ??
    parts.find((p) => p.startsWith("renew:"))
  const text = pick ? PLAN_NOTICE[pick] : undefined
  if (!text) return null
  return (
    <div
      role="status"
      data-testid="plan-notice"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-chart-4/15 px-4 py-2 text-body-sm text-ink ring-1 ring-chart-4/40"
    >
      <span>{text}</span>
      <Link
        href={orgPages(slug).manage("/billing")}
        className="font-medium text-primary underline"
      >
        Plan and billing
      </Link>
    </div>
  )
}
