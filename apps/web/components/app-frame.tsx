"use client"

import {
  BookOpenIcon,
  CaretDownIcon,
  GearSixIcon,
  type Icon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

import { LogoMark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { AccountMenu } from "@/features/account/account-menu"
import { useViewer } from "@/features/account/use-viewer"
import { NotificationBell } from "@/features/notifications/components/bell"
import { HomeLink } from "@/components/home-link"

/*
 * The frame of the app's working areas (a school, the platform admin): a shadcn Sidebar,
 * full on laptops and PCs, an icon rail on tablets and a slide-out menu on phones, and a
 * header with where you are, notifications, theme and account. Each area hands it its
 * own groups of links.
 */

export interface FrameItem {
  key: string
  label: string
  href: string
  icon: Icon
  badge?: string
}

export interface FrameGroup {
  /** "" for the ungrouped top (Home). */
  group: string
  items: FrameItem[]
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
 * Sidebar groups this person folded away, remembered on this device (per navigation, so a
 * school's and the platform's don't mix). Every group starts open; a long sidebar can be
 * cut down to what someone uses without anything being hidden by default.
 */
function useFolded(navLabel: string) {
  const key = `gretlab.folded.${navLabel}`
  const [folded, setFolded] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown
      if (Array.isArray(saved)) setFolded(new Set(saved.map(String)))
    } catch {
      // Storage off or unreadable: everything stays open.
    }
  }, [key])
  const toggle = (group: string) =>
    setFolded((cur) => {
      const next = new Set(cur)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      try {
        localStorage.setItem(key, JSON.stringify([...next]))
      } catch {
        // Not remembered; it still folds for now.
      }
      return next
    })
  return [folded, toggle] as const
}

/**
 * Keeps the page you're on in view in a long sidebar: after each navigation the active
 * item is scrolled into the visible part, without moving the page itself.
 */
function useActiveInView() {
  const box = useRef<HTMLDivElement | null>(null)
  const pathname = usePathname()
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const active = box.current?.querySelector<HTMLElement>(
        '[data-active="true"], [data-active=""], [aria-current="page"]'
      )
      active?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname])
  return box
}

/** Where the docs live, linked from every sidebar's footer. */
const DOCS_URL = "https://docs.gretlab.grettech.com"

export function AppFrame({
  brand,
  navLabel,
  groups,
  loading,
  isActive,
  title,
  badge,
  headerExtra,
  profileHref,
  children,
}: {
  /** The block at the top of the sidebar. */
  brand: {
    /** Initials on a tile, or "logo" for GretLab's own mark. */
    mark: string
    title?: string
    subtitle?: string
    href: string
    tooltip: string
  }
  /** The navigation's accessible name ("Organization", "Dashboard"). */
  navLabel: string
  groups: FrameGroup[]
  loading?: boolean
  isActive: (href: string) => boolean
  /** Shown in the header after the logo. */
  title?: string
  badge?: string
  headerExtra?: ReactNode
  /** The signed-in person's profile in this area, linked from the sidebar's footer. */
  profileHref?: string
  children: ReactNode
}) {
  const [open, setOpen] = useWideEnough()
  const [folded, toggleFolded] = useFolded(navLabel)
  const content = useActiveInView()
  const { data: viewer } = useViewer()
  const person = viewer?.user
  return (
    <TooltipProvider>
      <SidebarProvider open={open} onOpenChange={setOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  render={<Link href={brand.href} />}
                  tooltip={brand.tooltip}
                >
                  {brand.mark === "logo" ? (
                    <LogoMark className="size-8 shrink-0 text-ink" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink font-mono text-xs font-bold text-canvas"
                    >
                      {brand.mark}
                    </span>
                  )}
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    {brand.title ? (
                      <>
                        <span className="truncate text-sm font-semibold text-ink">
                          {brand.title}
                        </span>
                        {brand.subtitle && (
                          <span className="truncate text-xs text-muted-foreground">
                            {brand.subtitle}
                          </span>
                        )}
                      </>
                    ) : (
                      <Skeleton className="h-8 w-32" />
                    )}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent ref={content}>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="px-3 py-1.5">
                  <Skeleton className="h-6 w-full" />
                </div>
              ))}
            <nav aria-label={navLabel} className="flex flex-col gap-2">
              {groups.map((g) => {
                // A folded group still shows the page you're on.
                const shut = Boolean(g.group) && folded.has(g.group)
                const items = shut
                  ? g.items.filter((item) => isActive(item.href))
                  : g.items
                return (
                  <SidebarGroup key={g.group || "home"}>
                    {g.group && (
                      <SidebarGroupLabel
                        render={
                          <button
                            type="button"
                            aria-expanded={!shut}
                            onClick={() => toggleFolded(g.group)}
                          />
                        }
                        className="w-full cursor-pointer justify-between hover:text-sidebar-foreground"
                      >
                        {g.group}
                        <CaretDownIcon
                          aria-hidden
                          className={cn(
                            "transition-transform",
                            shut && "-rotate-90"
                          )}
                        />
                      </SidebarGroupLabel>
                    )}
                    <SidebarMenu>
                      {items.map((item) => (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            isActive={isActive(item.href)}
                            tooltip={item.label}
                            render={<Link href={item.href} />}
                          >
                            <item.icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                          {item.badge && (
                            <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                          )}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroup>
                )
              })}
            </nav>
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border">
            <SidebarMenu>
              {person && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="lg"
                    tooltip={`${person.name ?? person.email}: your profile`}
                    render={<Link href={profileHref ?? "/account"} />}
                    isActive={false}
                    data-testid="sidebar-profile"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-ink"
                    >
                      {initials(person.name ?? person.email)}
                    </span>
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-medium text-ink">
                        {person.name ?? person.email}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {person.email}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Account"
                  render={<Link href="/account" />}
                >
                  <GearSixIcon />
                  <span>Account</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Docs and help"
                  render={
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" />
                  }
                >
                  <BookOpenIcon />
                  <span>Docs and help</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="min-w-0 bg-canvas">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-canvas/95 px-3 backdrop-blur sm:px-4">
            <SidebarTrigger aria-label="Toggle the menu" />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <HomeLink
              className="flex shrink-0 items-center"
              aria-label={`${viewer?.siteTitle ?? "GretLab"} home`}
            >
              <LogoMark className="size-7 text-ink" />
            </HomeLink>
            {title && (
              <span className="min-w-0 truncate text-sm font-medium text-ink">
                {title}
              </span>
            )}
            {badge && (
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {badge}
              </Badge>
            )}
            <span className="flex-1" />
            {headerExtra}
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

/** "Asha Rao" → "AR"; an address's first letters otherwise. */
function initials(name: string) {
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean)
  return (
    (words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")
  ).toUpperCase() || "?"
}
