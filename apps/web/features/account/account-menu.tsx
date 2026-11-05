"use client"

import { CaretDownIcon, ListIcon } from "@phosphor-icons/react"
import { signOut } from "next-auth/react"
import Link from "next/link"
import { usePathname } from "next/navigation"

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

import { useViewer, type Viewer } from "./use-viewer"

interface NavItem {
  href: string
  label: string
  /** Other path prefixes that belong to this section. */
  also?: string[]
}

/** The site's main sections, in the order students use them. */
function sections(viewer: Viewer | undefined): NavItem[] {
  const user = viewer?.user
  const staff = user?.role === "teacher" || user?.role === "admin"
  const items: (NavItem | false | null | undefined)[] = [
    viewer?.features.practice && {
      href: "/problems",
      label: "Problems",
      also: ["/lists"],
    },
    user &&
      viewer?.features.assignments && {
        href: "/assignments",
        label: "Assignments",
      },
    viewer?.features.contests && { href: "/contests", label: "Contests" },
    user &&
      viewer?.features.profiles && {
        href: "/leaderboard",
        label: "Leaderboard",
        also: ["/u"],
      },
    user?.teaches && { href: "/teach", label: "Teach" },
    { href: "/playground", label: "Playground" },
    staff && { href: "/admin", label: "Dashboard" },
  ]
  return items.filter((item): item is NavItem => Boolean(item))
}

const isActive = (item: NavItem, pathname: string) =>
  [item.href, ...(item.also ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  )

/** Main sections, shown inline from tablet width up. */
export function PrimaryNav() {
  const { data: viewer } = useViewer()
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {sections(viewer).map((item) => {
        const active = isActive(item, pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm px-2.5 py-1.5 text-nav text-body hover:bg-muted hover:text-ink",
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

  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Menu" />}
        >
          <ListIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {sections(viewer).map((item) => (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href} />}
              aria-current={isActive(item, pathname) ? "page" : undefined}
              className="text-nav"
            >
              {item.label}
            </DropdownMenuItem>
          ))}
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
    return (
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
        <DropdownMenuItem render={<Link href="/orgs" />}>
          My organizations
        </DropdownMenuItem>
        {viewer.features.lists && (
          <DropdownMenuItem render={<Link href="/lists" />}>
            My lists
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
