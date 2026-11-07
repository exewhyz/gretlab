"use client"

import {
  CaretDownIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CheckIcon,
} from "@phosphor-icons/react"
import {
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

export interface PickerGroup {
  id: string
  name: string
  parentId: string | null
}

/** A group with what the picker needs to draw it: depth, path and what's inside. */
export interface PlacedGroup<T extends PickerGroup = PickerGroup> {
  group: T
  depth: number
  path: string[]
  children: number
}

/**
 * Groups in tree order. A group whose parent isn't in the list (a teacher who sees only
 * their sections) starts its own tree, so nothing goes missing.
 */
export function placeGroups<T extends PickerGroup>(groups: readonly T[]) {
  const ids = new Set(groups.map((g) => g.id))
  const out: PlacedGroup<T>[] = []
  const visit = (parentId: string | null, depth: number, path: string[]) => {
    const here = groups
      .filter((g) =>
        parentId === null
          ? g.parentId === null || !ids.has(g.parentId)
          : g.parentId === parentId
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )
    for (const g of here) {
      const children = groups.filter((x) => x.parentId === g.id).length
      out.push({ group: g, depth, path: [...path, g.name], children })
      visit(g.id, depth + 1, [...path, g.name])
    }
  }
  visit(null, 0, [])
  return out
}

/** Moves focus between a list's options with the arrow keys. */
export function arrowKeys(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
  const options = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-option]:not([disabled])"
    ),
  ]
  if (options.length === 0) return
  event.preventDefault()
  const at = options.indexOf(document.activeElement as HTMLElement)
  const next =
    event.key === "ArrowDown"
      ? options[Math.min(at + 1, options.length - 1)]
      : options[Math.max(at - 1, 0)]
  next?.focus()
}

/** Ancestors of the groups given, so a tree can open where something is chosen. */
export function ancestorsOf(
  groups: readonly PickerGroup[],
  ids: readonly string[]
) {
  const out = new Set<string>()
  for (const id of ids) {
    let parent = groups.find((g) => g.id === id)?.parentId ?? null
    while (parent && !out.has(parent)) {
      out.add(parent)
      parent = groups.find((g) => g.id === parent)?.parentId ?? null
    }
  }
  return out
}

/**
 * Choose one group from an organization's tree. The list keeps the tree's shape (folded
 * below the top level unless it's small), names each level ("Section", "Lab"), and a
 * search shows the full path of every match. Replaces a plain select, which flattens the
 * tree and grows past the screen.
 */
export function GroupPicker({
  groups,
  value,
  onChange,
  label,
  levels = [],
  placeholder = "Choose a group",
  heading,
  extra = [],
  isDisabled = () => false,
  trigger,
  className,
}: {
  groups: readonly PickerGroup[]
  value: string
  onChange: (id: string) => void
  /** The trigger's accessible name: "Move them to". */
  label: string
  /** The organization's level names, to say what each group is. */
  levels?: readonly string[]
  placeholder?: string
  /** A line above the list saying what picking does. */
  heading?: string
  /** Choices that aren't groups, shown first: "Everyone", "Whole organization". */
  extra?: readonly { value: string; label: string }[]
  isDisabled?: (id: string) => boolean
  /** A custom trigger (a "Move" button); the default looks like a select. */
  trigger?: ReactElement
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const placed = useMemo(() => placeGroups(groups), [groups])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const selected = placed.find((p) => p.group.id === value)
  const shownText =
    selected?.path.join(" › ") ??
    extra.find((e) => e.value === value)?.label ??
    placeholder

  const openPicker = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setQuery("")
    // Small trees open fully; big ones show the top level and the way to what's chosen.
    setExpanded(
      placed.length <= 12
        ? new Set(placed.filter((p) => p.children > 0).map((p) => p.group.id))
        : new Set([
            ...placed.filter((p) => p.depth === 0).map((p) => p.group.id),
            ...ancestorsOf(groups, value ? [value] : []),
          ])
    )
  }
  const choose = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const q = query.trim().toLowerCase()
  const matches = q
    ? placed.filter((p) => p.path.join(" ").toLowerCase().includes(q))
    : []
  const visible = placed.filter((p) => {
    let parent = p.group.parentId
    while (parent && placed.some((x) => x.group.id === parent)) {
      if (!expanded.has(parent)) return false
      parent = placed.find((x) => x.group.id === parent)!.group.parentId
    }
    return true
  })
  const LIMIT = 100

  return (
    <Popover open={open} onOpenChange={openPicker}>
      <PopoverTrigger
        render={
          trigger ?? (
            <Button
              variant="outline"
              aria-label={label}
              title={shownText}
              className={cn(
                "w-full justify-between gap-2 font-normal",
                !selected && !extra.some((e) => e.value === value)
                  ? "text-muted-foreground"
                  : "text-ink",
                className
              )}
            />
          )
        }
      >
        {trigger ? undefined : (
          <>
            <span className="truncate">{shownText}</span>
            <CaretUpDownIcon className="size-3.5 shrink-0 opacity-60" />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="grid w-(--anchor-width) min-w-72 grid-cols-[minmax(0,1fr)] gap-2 p-2"
        data-testid="group-picker"
      >
        {heading && <p className="px-1 text-caption text-body">{heading}</p>}
        <Input
          autoFocus
          aria-label="Search groups"
          placeholder={`Search ${groups.length} groups`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              e.currentTarget
                .closest("[data-testid=group-picker]")
                ?.querySelector<HTMLElement>("[data-option]:not([disabled])")
                ?.focus()
            }
            if (e.key === "Enter" && matches.length === 1) {
              e.preventDefault()
              if (!isDisabled(matches[0]!.group.id))
                choose(matches[0]!.group.id)
            }
          }}
        />
        <div
          role="listbox"
          aria-label={label}
          className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-px overflow-auto"
          onKeyDown={arrowKeys}
        >
          {!q &&
            extra.map((e) => (
              <Option
                key={e.value}
                selected={value === e.value}
                onClick={() => choose(e.value)}
                name={e.label}
              >
                <span className="truncate">{e.label}</span>
              </Option>
            ))}
          {!q && extra.length > 0 && groups.length > 0 && (
            <div className="my-1 border-t border-hairline" />
          )}
          {q
            ? matches.slice(0, LIMIT).map((p) => (
                <Option
                  key={p.group.id}
                  selected={value === p.group.id}
                  disabled={isDisabled(p.group.id)}
                  onClick={() => choose(p.group.id)}
                  name={p.path.join(" › ")}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {p.path.length > 1 && (
                      <span className="text-body">
                        {p.path.slice(0, -1).join(" › ")} ›{" "}
                      </span>
                    )}
                    {p.group.name}
                  </span>
                  <Level text={levels[p.depth]} />
                </Option>
              ))
            : visible.map((p) => (
                <div
                  key={p.group.id}
                  className="flex items-center gap-0.5"
                  style={{ paddingInlineStart: p.depth * 16 }}
                >
                  {p.children > 0 ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      tabIndex={-1}
                      aria-label={`${expanded.has(p.group.id) ? "Collapse" : "Expand"} ${p.group.name}`}
                      onClick={() =>
                        setExpanded((cur) => {
                          const next = new Set(cur)
                          if (next.has(p.group.id)) next.delete(p.group.id)
                          else next.add(p.group.id)
                          return next
                        })
                      }
                    >
                      {expanded.has(p.group.id) ? (
                        <CaretDownIcon />
                      ) : (
                        <CaretRightIcon />
                      )}
                    </Button>
                  ) : (
                    <span aria-hidden className="w-6 shrink-0" />
                  )}
                  <Option
                    selected={value === p.group.id}
                    disabled={isDisabled(p.group.id)}
                    onClick={() => choose(p.group.id)}
                    name={p.path.join(" › ")}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.group.name}
                    </span>
                    {p.children > 0 && (
                      <span className="shrink-0 text-xs text-body">
                        {p.children} inside
                      </span>
                    )}
                    <Level text={levels[p.depth]} />
                  </Option>
                </div>
              ))}
          {q && matches.length === 0 && (
            <p className="px-2 py-3 text-caption text-body">
              No group matches “{query.trim()}”.
            </p>
          )}
          {q && matches.length > LIMIT && (
            <p className="px-2 py-1.5 text-xs text-body">
              Showing {LIMIT} of {matches.length}. Type more to narrow it down.
            </p>
          )}
          {!q && groups.length === 0 && (
            <p className="px-2 py-3 text-caption text-body">No groups yet.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Option({
  selected,
  disabled,
  onClick,
  name,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  name: string
  children: ReactNode
}) {
  return (
    <Button
      data-option
      role="option"
      aria-selected={selected}
      aria-label={name}
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-auto min-w-0 flex-1 justify-start gap-2 py-1.5 text-start font-normal",
        selected && "bg-muted"
      )}
    >
      <CheckIcon
        className={cn(
          "size-3.5 shrink-0",
          selected ? "opacity-100" : "opacity-0"
        )}
      />
      {children}
    </Button>
  )
}

function Level({ text }: { text?: string }) {
  if (!text) return null
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-xs leading-4 text-body">
      {text}
    </span>
  )
}
