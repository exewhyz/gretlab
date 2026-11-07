"use client"

import {
  ArrowUpRightIcon,
  BuildingsIcon,
  CaretUpDownIcon,
  UserIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import {
  PERSONAL,
  useContentScope,
  type Scope,
  type ScopeOrg,
} from "@/features/account/scope"

/** "Everything", "Personal", "GLA University", or "GLA University +2". */
export function scopeLabel(scope: Scope, orgs: readonly ScopeOrg[]) {
  if (!scope) return "Everything"
  const names = scope.map((t) =>
    t === PERSONAL ? "Personal" : (orgs.find((o) => o.slug === t)?.name ?? t)
  )
  return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`
}

/**
 * Next to the site title: choose whose content the lists show. Everything, personal
 * only, one organization, or any mix; each organization can also be opened.
 * Shown only to people in at least one organization.
 */
export function ScopeSwitcher() {
  const { orgs, scope, setScope } = useContentScope()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  if (orgs.length === 0) return null

  const all = [PERSONAL, ...orgs.map((o) => o.slug)]
  const ticked = new Set(scope ?? all)
  const apply = (next: string[]) => {
    // Nothing ticked, or everything ticked, both mean everything.
    setScope(next.length === 0 || next.length === all.length ? null : next)
  }
  const toggle = (token: string, on: boolean) =>
    apply(all.filter((t) => (t === token ? on : ticked.has(t))))
  const only = (token: string) => {
    apply([token])
    setOpen(false)
  }

  const q = query.trim().toLowerCase()
  const shown = orgs.filter((o) => !q || o.name.toLowerCase().includes(q))
  const label = scopeLabel(scope, orgs)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery("")
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Showing: ${label}`}
            data-testid="scope-switcher"
            className={cn(
              "max-w-48 gap-1.5 font-normal",
              scope && "border-primary/40 bg-primary/5"
            )}
          />
        }
      >
        {scope?.length === 1 && scope[0] === PERSONAL ? (
          <UserIcon className="size-3.5 shrink-0" />
        ) : (
          <BuildingsIcon className="size-3.5 shrink-0" />
        )}
        <span className="hidden truncate sm:inline">{label}</span>
        <CaretUpDownIcon className="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="grid w-80 grid-cols-[minmax(0,1fr)] gap-2 p-2"
        data-testid="scope-menu"
      >
        <div className="px-1">
          <div className="text-caption font-semibold text-ink">
            Show content from
          </div>
          <p className="text-xs text-body">
            Assignments, contests, problems and classes. Tick any mix.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "justify-start font-normal",
            !scope && "bg-muted text-ink"
          )}
          aria-pressed={!scope}
          onClick={() => {
            apply([])
            setOpen(false)
          }}
        >
          Everything
          <span className="ms-auto text-xs text-body">
            {orgs.length + 1} places
          </span>
        </Button>
        <div className="border-t border-hairline" />
        <Place
          label="Personal"
          detail="Not from any organization"
          icon={<UserIcon className="size-4" />}
          checked={ticked.has(PERSONAL)}
          onCheckedChange={(on) => toggle(PERSONAL, on)}
          onOnly={() => only(PERSONAL)}
        />
        {orgs.length > 6 && (
          <Input
            aria-label="Search your organizations"
            placeholder={`Search ${orgs.length} organizations`}
            className="h-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-px overflow-auto">
          {shown.map((o) => (
            <Place
              key={o.slug}
              label={o.name}
              detail={o.type[0]!.toUpperCase() + o.type.slice(1)}
              icon={<BuildingsIcon className="size-4" />}
              checked={ticked.has(o.slug)}
              onCheckedChange={(on) => toggle(o.slug, on)}
              onOnly={() => only(o.slug)}
              href={`/orgs/${o.slug}`}
              onOpen={() => setOpen(false)}
            />
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-2 text-xs text-body">Nothing matches.</p>
          )}
        </div>
        <div className="border-t border-hairline pt-1">
          <Link
            href="/orgs"
            onClick={() => setOpen(false)}
            className={cn(
              buttonVariants({ variant: "link", size: "xs" }),
              "px-1"
            )}
          >
            Your organizations and joining more
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Place({
  label,
  detail,
  icon,
  checked,
  onCheckedChange,
  onOnly,
  href,
  onOpen,
}: {
  label: string
  detail: string
  icon: ReactNode
  checked: boolean
  onCheckedChange: (on: boolean) => void
  onOnly: () => void
  href?: string
  onOpen?: () => void
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox
          aria-label={`Show ${label}`}
          checked={checked}
          onCheckedChange={(on) => onCheckedChange(on === true)}
        />
        <span className="shrink-0 text-body">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-body-sm text-ink">{label}</span>
          <span className="block truncate text-xs text-body">{detail}</span>
        </span>
      </label>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Only ${label}`}
        className="opacity-70 group-hover:opacity-100"
        onClick={onOnly}
      >
        Only
      </Button>
      {href && (
        <Link
          href={href}
          onClick={onOpen}
          aria-label={`Open ${label}`}
          title={`Open ${label}`}
          className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
        >
          <ArrowUpRightIcon />
        </Link>
      )}
    </div>
  )
}

/**
 * On a list while it's narrowed: what's showing and how many items are hidden, so
 * nothing looks missing by accident.
 */
export function ScopeNote({ hidden }: { hidden: number }) {
  const { orgs, scope, setScope } = useContentScope()
  if (!scope) return null
  return (
    <p
      data-testid="scope-note"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-caption text-ink"
    >
      <span>
        Showing{" "}
        <strong className="font-semibold">{scopeLabel(scope, orgs)}</strong>
        {scope.length > 1 &&
          ` (${scope
            .map((t) =>
              t === PERSONAL
                ? "Personal"
                : (orgs.find((o) => o.slug === t)?.name ?? t)
            )
            .join(", ")})`}
        {hidden > 0 &&
          ` · ${hidden} more from other places ${hidden === 1 ? "is" : "are"} hidden`}
      </span>
      <Button
        size="xs"
        variant="outline"
        className="ms-auto"
        onClick={() => setScope(null)}
      >
        Show everything
      </Button>
    </p>
  )
}
