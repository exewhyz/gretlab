"use client"

import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { useId, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"

export interface PermissionInfo {
  label: string
  description: string
  module: string
  parent?: string
}

/**
 * Picks permissions for a role, for any catalog (organization or platform) whose entries
 * may name a `parent`.
 *
 * - A bar at the top (sticky inside a scrolling sheet) searches every permission by name
 *   and what it allows, says how many are chosen, and jumps to each area with its count.
 * - Top-level permissions are listed by area; one with finer actions is a row you expand
 *   to reveal them (a search opens the ones whose actions match). Ticking a parent grants
 *   and locks every action under it.
 * - You can only give what you hold (`held`; null means everything), counting a parent you
 *   hold as holding its children.
 */
export function PermissionPicker({
  catalog,
  order,
  held,
  value,
  onChange,
}: {
  catalog: Record<string, PermissionInfo>
  order: string[]
  held: string[] | null
  value: string[]
  onChange: (permissions: string[]) => void
}) {
  const id = useId()
  const info = (k: string) => catalog[k] as PermissionInfo
  const parentOf = (k: string) => info(k)?.parent ?? null
  const ancestors = (k: string) => {
    const chain = [k]
    for (let p = parentOf(k); p; p = parentOf(p)) chain.push(p)
    return chain
  }
  const effectively = (set: string[], k: string) =>
    ancestors(k).some((a) => set.includes(a))
  const grantable = (k: string) => held === null || effectively(held, k)
  const childrenOf = (parent: string) =>
    order.filter((k) => parentOf(k) === parent)
  const modules = [...new Set(order.map((k) => info(k).module))]
  const tops = (module: string) =>
    order.filter((k) => info(k).module === module && !parentOf(k))
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState("")
  const set = (k: string, on: boolean) =>
    onChange(on ? [...value, k] : value.filter((x) => x !== k))

  // Searching: a permission matches on its name or what it allows.
  const term = q.trim().toLowerCase()
  const matches = (k: string) =>
    !term ||
    `${info(k).label} ${info(k).description}`.toLowerCase().includes(term)
  const shownTop = (k: string) => matches(k) || childrenOf(k).some(matches)
  // How many an area grants, counting a ticked parent's actions as granted.
  const chosenIn = (module: string) =>
    order.filter((k) => info(k).module === module && effectively(value, k))
      .length
  const totalChosen = order.filter((k) => effectively(value, k)).length
  const areaId = (module: string) =>
    `${id}-area-${module.toLowerCase().replace(/\W+/g, "-")}`

  const Row = ({ k, child }: { k: string; child?: boolean }) => {
    const allowed = grantable(k)
    const byParent = child && value.includes(parentOf(k)!)
    return (
      <label
        className={cn(
          "flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60",
          child && "ml-7",
          (!allowed || byParent) && "opacity-60 hover:bg-transparent"
        )}
        title={
          !allowed
            ? "You don't have this permission, so you can't give it."
            : byParent
              ? `Granted by “${info(parentOf(k)!).label}”.`
              : undefined
        }
      >
        <Checkbox
          className="mt-0.5"
          disabled={!allowed || byParent}
          checked={effectively(value, k)}
          onCheckedChange={(on) => set(k, on)}
        />
        <span className="grid gap-0.5">
          <span className="text-body-sm text-ink">{info(k).label}</span>
          <span className="text-caption text-body">{info(k).description}</span>
        </span>
      </label>
    )
  }

  const shownModules = modules.filter((m) => tops(m).some(shownTop))

  return (
    <div className="grid gap-3">
      {/* Search, the count, and a way to each area: in view while the list scrolls. */}
      {/* -top-4 meets the scroll area's top padding, so nothing shows above the bar. */}
      <div className="sticky -top-4 z-[1] -mx-1 grid gap-2 bg-popover px-1 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search permissions"
              placeholder="Search permissions"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </InputGroup>
          <span
            className="text-caption whitespace-nowrap text-muted-foreground tabular-nums"
            data-testid="permissions-chosen"
          >
            {totalChosen} of {order.length} chosen
          </span>
        </div>
        {!term && (
          <nav aria-label="Areas" className="flex flex-wrap gap-1">
            {modules.map((module) => {
              const n = chosenIn(module)
              return (
                <Button
                  key={module}
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="gap-1 bg-muted/60"
                  onClick={() =>
                    document
                      .getElementById(areaId(module))
                      ?.scrollIntoView({ block: "start", behavior: "smooth" })
                  }
                >
                  {module}
                  {n > 0 && (
                    <span className="text-muted-foreground tabular-nums">
                      {n}
                    </span>
                  )}
                </Button>
              )
            })}
          </nav>
        )}
      </div>

      {shownModules.length === 0 && (
        <p className="px-2 text-body-sm text-muted-foreground">
          No permission matches “{q.trim()}”.
        </p>
      )}
      {shownModules.map((module) => (
        <fieldset
          key={module}
          id={areaId(module)}
          className="grid scroll-mt-28 gap-0.5"
        >
          <legend className="mb-1 flex w-full items-center justify-between px-2 text-caption-upper text-body uppercase">
            {module}
            {chosenIn(module) > 0 && (
              <span className="text-caption font-normal tracking-normal text-muted-foreground normal-case tabular-nums">
                {chosenIn(module)} chosen
              </span>
            )}
          </legend>
          {tops(module)
            .filter(shownTop)
            .map((parent) => {
              const kids = childrenOf(parent)
              if (kids.length === 0) return <Row key={parent} k={parent} />
              const chosen = kids.filter((k) => value.includes(k)).length
              // A search opens a parent whose actions match.
              const expanded =
                open[parent] ?? (term !== "" && kids.some(matches))
              const summary = value.includes(parent)
                ? "All actions"
                : chosen > 0
                  ? `${chosen} of ${kids.length}`
                  : null
              return (
                <div key={parent}>
                  <div className="flex items-start gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} the actions under ${info(parent).label}`}
                      onClick={() =>
                        setOpen((o) => ({ ...o, [parent]: !expanded }))
                      }
                      className="mt-1.5 text-body"
                    >
                      <CaretRightIcon
                        className={cn(
                          "transition-transform",
                          expanded && "rotate-90"
                        )}
                      />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <Row k={parent} />
                    </div>
                    {summary && (
                      <Badge variant="secondary" className="mt-2">
                        {summary}
                      </Badge>
                    )}
                  </div>
                  {expanded && (
                    <div className="ml-2.5 border-l border-hairline pl-1">
                      {kids
                        .filter((k) => !term || matches(k) || matches(parent))
                        .map((k) => (
                          <Row key={k} k={k} child />
                        ))}
                    </div>
                  )}
                </div>
              )
            })}
        </fieldset>
      ))}
    </div>
  )
}
