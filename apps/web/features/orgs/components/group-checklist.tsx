"use client"

import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { ancestorsOf } from "./group-picker"

export interface TreeGroup {
  id: string
  name: string
  parentId: string | null
}

/** Groups in tree order with their depth: each parent followed by its children. */
export function treeOrdered<T extends TreeGroup>(groups: readonly T[]) {
  const out: (T & { depth: number })[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parentId === parentId)) {
      out.push({ ...g, depth })
      visit(g.id, depth + 1)
    }
  }
  visit(null, 0)
  return out
}

function descendants(groups: readonly TreeGroup[], id: string): string[] {
  const kids = groups.filter((g) => g.parentId === id).map((g) => g.id)
  return kids.flatMap((k) => [k, ...descendants(groups, k)])
}

function ancestors(groups: readonly TreeGroup[], id: string): string[] {
  const parent = groups.find((g) => g.id === id)?.parentId
  return parent ? [parent, ...ancestors(groups, parent)] : []
}

/** A selection with every ticked group's children included, as the boxes show it. */
export function expandSelection(
  groups: readonly TreeGroup[],
  ids: readonly string[]
) {
  return [...new Set(ids.flatMap((id) => [id, ...descendants(groups, id)]))]
}

/** Only the topmost ticked groups: "3rd Year" rather than "3rd Year, Sec A, Sec B". */
export function topmost(groups: readonly TreeGroup[], ids: readonly string[]) {
  const set = new Set(ids)
  return ids.filter((id) => !ancestors(groups, id).some((a) => set.has(a)))
}

/**
 * Checkboxes for a group tree. Ticking a group ticks everything inside it; unticking any
 * group also unticks the groups above it, which no longer have everything inside them.
 * A group with only some of its groups ticked shows a partial tick.
 *
 * Built for big trees: it scrolls instead of growing, folds below the top level (unless
 * the tree is small, and always open down to what's ticked), and a search shows matches
 * with the groups above them.
 */
export function GroupChecklist({
  groups,
  value,
  onChange,
  labelFor = (g) => g.name,
  size = "md",
  levels = [],
}: {
  groups: readonly TreeGroup[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  labelFor?: (group: TreeGroup) => string
  size?: "sm" | "md"
  /** The organization's level names, shown beside each group. */
  levels?: readonly string[]
}) {
  const [query, setQuery] = useState("")
  const parents = groups
    .filter((g) => groups.some((x) => x.parentId === g.id))
    .map((g) => g.id)
  // Folding by default: small trees open, big ones show the top level and the way down
  // to anything ticked. Worked out every render, since groups often arrive after the
  // first one; only the person's own folding is remembered.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  const opened = new Set(
    groups.length <= 12
      ? parents
      : [
          ...groups.filter((g) => g.parentId === null).map((g) => g.id),
          ...ancestorsOf(groups, value),
        ]
  )
  const isOpen = (id: string) => toggled.get(id) ?? opened.has(id)
  const allOpen = parents.every(isOpen)
  const fold = (ids: string[], open: boolean) =>
    setToggled((cur) => {
      const next = new Map(cur)
      for (const id of ids) next.set(id, open)
      return next
    })
  const selected = new Set(expandSelection(groups, value))
  // A group with everything inside it ticked shows as ticked too, deepest first.
  for (const g of [...treeOrdered(groups)].reverse()) {
    const inside = descendants(groups, g.id)
    if (inside.length && inside.every((x) => selected.has(x)))
      selected.add(g.id)
  }
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected)
    const below = [id, ...descendants(groups, id)]
    if (checked) below.forEach((x) => next.add(x))
    else [...below, ...ancestors(groups, id)].forEach((x) => next.delete(x))
    // A parent whose groups are now all ticked becomes ticked too.
    for (const a of ancestors(groups, id)) {
      const inside = descendants(groups, a)
      if (inside.length && inside.every((x) => next.has(x))) next.add(a)
    }
    onChange(groups.map((g) => g.id).filter((x) => next.has(x)))
  }
  const ordered = treeOrdered(groups)
  const pathOf = (g: TreeGroup) =>
    [...ancestors(groups, g.id).reverse(), g.id]
      .map((id) => groups.find((x) => x.id === id)?.name ?? "")
      .join(" ")
      .toLowerCase()
  const q = query.trim().toLowerCase()
  // Searching shows each match and the groups above it, so the tree keeps its shape.
  const matched = new Set(
    q ? ordered.filter((g) => pathOf(g).includes(q)).map((g) => g.id) : []
  )
  const withAbove = new Set([...matched, ...ancestorsOf(groups, [...matched])])
  const shown = ordered.filter((g) =>
    q ? withAbove.has(g.id) : ancestors(groups, g.id).every(isOpen)
  )
  const ticked = groups.filter(
    (g) => selected.has(g.id) && !groups.some((x) => x.parentId === g.id)
  ).length
  const big = groups.length > 8
  const indent = size === "sm" ? 14 : 18

  return (
    <div className="grid gap-1.5">
      {big && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            aria-label="Find a group"
            placeholder={`Search ${groups.length} groups`}
            className="h-7 max-w-56 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!q && parents.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => fold(parents, !allOpen)}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          )}
          <span className="ms-auto text-xs text-body">
            {ticked} {ticked === 1 ? "group" : "groups"} ticked
          </span>
        </div>
      )}
      <div
        className={cn(
          "grid gap-0.5",
          big &&
            "max-h-64 overflow-auto rounded-sm border border-hairline p-1.5"
        )}
      >
        {shown.map((g) => {
          const inside = descendants(groups, g.id)
          const partial =
            !selected.has(g.id) && inside.some((x) => selected.has(x))
          const open = q ? true : isOpen(g.id)
          return (
            <div
              key={g.id}
              className="flex items-center gap-1"
              style={{ paddingInlineStart: g.depth * indent }}
            >
              {inside.length > 0 && !q ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${open ? "Collapse" : "Expand"} ${labelFor(g)}`}
                  onClick={() => fold([g.id], !open)}
                >
                  {open ? <CaretDownIcon /> : <CaretRightIcon />}
                </Button>
              ) : (
                <span aria-hidden className="w-6 shrink-0" />
              )}
              <label
                className={cn(
                  "flex min-w-0 flex-1 items-center",
                  size === "sm"
                    ? "gap-1.5 text-xs"
                    : "gap-2 text-body-sm text-ink",
                  q && !matched.has(g.id) && "text-body"
                )}
              >
                <Box
                  ariaLabel={labelFor(g)}
                  checked={selected.has(g.id)}
                  partial={partial}
                  onChange={(checked) => toggle(g.id, checked)}
                />
                <span className="truncate">{g.name}</span>
                {levels[g.depth] && (
                  <span className="shrink-0 text-xs text-body">
                    {levels[g.depth]}
                  </span>
                )}
                {!open && inside.length > 0 && (
                  <span className="shrink-0 text-xs text-body">
                    · {inside.length} inside
                  </span>
                )}
              </label>
            </div>
          )
        })}
        {q && shown.length === 0 && (
          <p className="p-1 text-xs text-body">No group matches.</p>
        )}
      </div>
    </div>
  )
}

/** The shared checkbox, which shows a partial tick itself. */
function Box({
  checked,
  partial,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  partial: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}) {
  return (
    <Checkbox
      aria-label={ariaLabel}
      checked={checked}
      indeterminate={partial}
      onCheckedChange={(value) => onChange(value === true)}
    />
  )
}

/** Groups with nothing inside them: where people sit. */
export const leafIds = (groups: readonly TreeGroup[]) =>
  groups
    .filter((g) => !groups.some((x) => x.parentId === g.id))
    .map((g) => g.id)
