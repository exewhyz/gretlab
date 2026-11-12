"use client"

import {
  BedIcon,
  BookOpenIcon,
  BooksIcon,
  BusIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
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
  ShieldCheckIcon,
  SquaresFourIcon,
  StackIcon,
  StudentIcon,
  TargetIcon,
  TrophyIcon,
  UploadSimpleIcon,
  UserIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { ORG_NAV, visibleOrgNav, type OrgType } from "@workspace/judge"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { ThemeToggle } from "@/components/theme-toggle"
import { AccountMenu } from "@/features/account/account-menu"
import { NotificationBell } from "@/features/notifications/components/bell"
import { api } from "@/lib/api/client"

export interface Shell {
  org: { slug: string; name: string; type: OrgType; active: boolean }
  views: ("admin" | "teacher" | "student" | "parent")[]
  role: string
  permissions: string[]
  modules: string[]
  pending: number
  children: { id: string; name: string }[]
}

export function useShell(slug: string) {
  return useQuery({
    queryKey: ["org", slug, "shell"],
    queryFn: () => api<Shell>(`/orgs/${slug}/shell`),
  })
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
  subjects: BookOpenIcon,
  timetable: CalendarDotsIcon,
  "my-timetable": CalendarDotsIcon,
  courses: StackIcon,
  outcomes: TargetIcon,
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
            : undefined,
      }))
    if (items.length) groups.push({ group: g.group, items })
  }
  // Students: their own pages.
  if (shell.views.includes("student")) {
    groups.push({
      group: "Learning",
      items: [
        { key: "classes", label: "My classes", href: "/classes" },
        ...(shell.modules.includes("library")
          ? [{ key: "books", label: "Library", href: `${base}/books` }]
          : []),
      ],
    })
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
    group: "This school",
    items: [
      { key: "profile", label: "About the school", href: `${base}/about` },
    ],
  })
  return groups
}

/** Tablets get the icon rail, larger screens the full sidebar; phones the slide-out menu. */
function useWideEnough() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)")
    const apply = () => setOpen(query.matches)
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])
  return [open, setOpen] as const
}

/**
 * The frame of every school page: a sidebar shaped by who you are here (shadcn Sidebar:
 * full on laptops and PCs, an icon rail on tablets, a slide-out menu on phones) and a
 * header with the school, your role, notifications, theme and account.
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
  const [open, setOpen] = useWideEnough()
  const groups = shell ? navFor(shell) : []
  const isActive = (href: string) =>
    href === `/orgs/${slug}`
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <TooltipProvider>
      <SidebarProvider open={open} onOpenChange={setOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  render={<Link href={`/orgs/${slug}`} />}
                  tooltip={shell?.org.name ?? "School"}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground"
                  >
                    {(shell?.org.name ?? "·").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    {shell ? (
                      <>
                        <span className="truncate text-sm font-semibold text-ink">
                          {shell.org.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {shell.role}
                          {!shell.org.active && " · Suspended"}
                        </span>
                      </>
                    ) : (
                      <Skeleton className="h-8 w-32" />
                    )}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            {!shell &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="px-3 py-1.5">
                  <Skeleton className="h-6 w-full" />
                </div>
              ))}
            <nav aria-label="Organization" className="flex flex-col gap-2">
              {groups.map((g) => (
                <SidebarGroup key={g.group || "home"}>
                  {g.group && <SidebarGroupLabel>{g.group}</SidebarGroupLabel>}
                  <SidebarMenu>
                    {g.items.map((item) => {
                      const Icon = ICONS[item.key] ?? SquaresFourIcon
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            isActive={isActive(item.href)}
                            tooltip={item.label}
                            render={<Link href={item.href} />}
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                          {item.badge && (
                            <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                          )}
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroup>
              ))}
            </nav>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="min-w-0 bg-canvas">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-canvas/95 px-3 backdrop-blur sm:px-4">
            <SidebarTrigger aria-label="Toggle the menu" />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Link
              href="/"
              className="font-mono text-sm font-bold tracking-tighter text-primary"
              aria-label="Gretlab home"
            >
              &gt;&gt;&gt;
            </Link>
            <span className="min-w-0 truncate text-sm font-medium text-ink">
              {shell?.org.name}
            </span>
            {shell && (
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {shell.role}
              </Badge>
            )}
            <span className="flex-1" />
            <NotificationBell />
            <ThemeToggle />
            <AccountMenu />
          </header>
          <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
