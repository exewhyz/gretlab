"use client"

import { CaretDownIcon, ListIcon } from "@phosphor-icons/react"
import { signOut } from "next-auth/react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import { writeMode, useMode, type Mode } from "./mode"
import { useContentScope } from "./scope"
import { useViewer, type Viewer } from "./use-viewer"

interface NavItem {
  href: string
  label: string
  /** Other path prefixes that belong to this section. */
  also?: string[]
}

/** Whether this person has a teaching side at all: an organization role or platform staff. */
export function canTeach(viewer: Viewer | undefined) {
  const user = viewer?.user
  return Boolean(
    user && (user.teaches || user.role === "teacher" || user.role === "admin")
  )
}

/** The main sections of the current mode, in the order people use them. */
function useSections(): NavItem[] {
  const { data: viewer } = useViewer()
  const { orgs } = useContentScope()
  const mode = useMode(canTeach(viewer))
  const user = viewer?.user
  const staff = user?.role === "teacher" || user?.role === "admin"
  const items: (NavItem | false | null | undefined)[] =
    mode === "teach"
      ? [
          user?.teaches && {
            href: "/teach",
            label: "My classes",
            also: ["/orgs"],
          },
          orgs.some((o) => o.canManage) &&
            !user?.teaches && { href: "/orgs", label: "Organizations" },
          staff && { href: "/admin", label: "Dashboard" },
          { href: "/playground", label: "Playground" },
        ]
      : [
          user && { href: "/home", label: "Home" },
          viewer?.features.practice && {
            href: "/problems",
            label: "Problems",
            also: ["/lists"],
          },
          orgs.length > 0 && { href: "/classes", label: "My classes" },
          user?.parent && { href: "/children", label: "My children" },
          user &&
            viewer?.features.assignments && {
              href: "/assignments",
              label: "Assignments",
            },
          viewer?.features.contests && {
            href: "/contests",
            label: "Contests",
          },
          user &&
            viewer?.features.profiles && {
              href: "/leaderboard",
              label: "Leaderboard",
              also: ["/u"],
            },
          { href: "/playground", label: "Playground" },
        ]
  return items.filter((item): item is NavItem => Boolean(item))
}

/**
 * Learn or Teach, for people who do both. Switching goes to that mode's home, so the
 * page and the header always agree.
 */
export function ModeToggle() {
  const { data: viewer } = useViewer()
  const router = useRouter()
  const show = canTeach(viewer)
  const mode = useMode(show)
  if (!show) return null
  const go = (next: Mode) => {
    writeMode(next)
    router.push(
      next === "teach"
        ? viewer?.user?.teaches
          ? "/teach"
          : "/admin"
        : viewer?.features.practice
          ? "/problems"
          : "/contests"
    )
  }
  return (
    <div
      role="group"
      aria-label="Mode"
      data-testid="mode-toggle"
      className="hidden items-center rounded-md border border-hairline p-0.5 sm:flex"
    >
      {(["learn", "teach"] as const).map((m) => (
        <Button
          key={m}
          size="xs"
          variant={mode === m ? "default" : "ghost"}
          aria-pressed={mode === m}
          onClick={() => mode !== m && go(m)}
          className="px-2.5"
        >
          {m === "learn" ? "Learn" : "Teach"}
        </Button>
      ))}
    </div>
  )
}

const isActive = (item: NavItem, pathname: string) =>
  [item.href, ...(item.also ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  )

/** Main sections, shown inline from tablet width up. */
export function PrimaryNav() {
  const pathname = usePathname()
  const items = useSections()

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const active = isActive(item, pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm px-2.5 py-1.5 text-nav whitespace-nowrap text-body hover:bg-muted hover:text-ink",
              active && "bg-muted text-ink"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** The same sections behind a button on phones. */
export function MobileNav() {
  const { data: viewer } = useViewer()
  const pathname = usePathname()
  const items = useSections()
  const teacher = canTeach(viewer)
  const mode = useMode(teacher)

  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Menu" />}
        >
          <ListIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href} />}
              aria-current={isActive(item, pathname) ? "page" : undefined}
              className="text-nav"
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          {teacher && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-nav"
                onClick={() => writeMode(mode === "teach" ? "learn" : "teach")}
                render={
                  <Link
                    href={
                      mode === "teach"
                        ? "/problems"
                        : viewer?.user?.teaches
                          ? "/teach"
                          : "/admin"
                    }
                  />
                }
              >
                Switch to {mode === "teach" ? "Learn" : "Teach"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** The signed-in person's own pages, or a sign-in button. */
export function AccountMenu() {
  const { data: viewer } = useViewer()
  const pathname = usePathname()
  const user = viewer?.user

  if (!viewer) return <span className="w-20" aria-hidden />
  if (!user) {
    return viewer.twoFactorPending ? (
      <Link
        href={`/sign-in/continue?next=${encodeURIComponent(pathname)}`}
        className={cn(buttonVariants({ size: "sm" }))}
      >
        Finish signing in
      </Link>
    ) : (
      <Link
        href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
        className={cn(buttonVariants({ size: "sm" }))}
      >
        Sign in
      </Link>
    )
  }

  const name = user.name || user.handle

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Account"
            className="h-auto gap-1.5 rounded-full py-0.5 ps-0.5 pe-1.5 text-nav text-ink"
          />
        }
      >
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground uppercase"
        >
          {name.slice(0, 1)}
        </span>
        <span className="hidden max-w-32 truncate lg:inline">{name}</span>
        <CaretDownIcon className="size-3 text-body" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5 py-2">
            <span className="truncate text-body-sm">{name}</span>
            <span className="truncate text-xs font-normal opacity-70">
              {user.email}
            </span>
            {user.role !== "student" && (
              <span className="mt-1 text-caption-upper text-primary uppercase">
                {user.role}
              </span>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {viewer.features.profiles && (
          <DropdownMenuItem render={<Link href={`/u/${user.handle}`} />}>
            My profile
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link href="/submissions" />}>
          My submissions
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/calendar" />}>
          Calendar
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/certificates" />}>
          My certificates
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/orgs" />}>
          My organizations
        </DropdownMenuItem>
        {viewer.features.lists && (
          <DropdownMenuItem render={<Link href="/lists" />}>
            My lists
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link href="/account/security" />}>
          Security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
