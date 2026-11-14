"use client"

import {
  AirplaneTiltIcon,
  ClipboardTextIcon,
  FingerprintIcon,
  BedIcon,
  BookOpenIcon,
  BooksIcon,
  BusIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  CalendarXIcon,
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
import { KINDS, ORG_NAV, visibleOrgNav, type OrgType } from "@workspace/judge"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { AppFrame } from "@/components/app-frame"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"

export interface Shell {
  org: { slug: string; name: string; type: OrgType; active: boolean }
  views: ("admin" | "teacher" | "student" | "parent" | "staff")[]
  role: string
  /** Permissions held anywhere here: across the organization or in some group. */
  permissions: string[]
  /** Of those, the ones held across the whole organization. */
  wholeOrg: string[]
  modules: string[]
  pending: number
  children: { id: string; name: string }[]
  leavePending?: number
  terms?: { groups: string }
  noun?: string
  admissionsNew?: number
}

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
      shell?.permissions.includes(permission) ?? false,
    /** This module is switched on. */
    has: (module: string) => shell?.modules.includes(module) ?? false,
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
  courses: StackIcon,
  outcomes: TargetIcon,
  training: SealCheckIcon,
  progress: TrendUpIcon,
  attendance: CheckSquareIcon,
  notices: MegaphoneIcon,
  books: BooksIcon,
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
      ],
    })
    if (shell.modules.includes("coding"))
      groups.push({
        group: "Coding lab",
        items: [
          { key: "assignments", label: "Assignments", href: "/assignments" },
          { key: "practice", label: "Practice", href: "/problems" },
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
      ...(shell.modules.includes("staffAttendance") &&
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
        title: shell?.org.name,
        subtitle: shell
          ? `${shell.role}${!shell.org.active ? " · Suspended" : ""}`
          : undefined,
        href: orgPages(slug).home,
        tooltip: shell?.org.name ?? "School",
      }}
      navLabel="Organization"
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
      {children}
    </AppFrame>
  )
}
