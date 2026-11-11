"use client"

import { CaretRightIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

export interface PermissionInfo {
  label: string
  description: string
  module: string
  parent?: string
}

/**
 * Picks permissions for a role, for any catalog (organization or platform) whose entries
 * may name a `parent`. Top-level permissions are listed by area; one with finer actions is
 * a row you expand to reveal them, so the list stays short until you look closer. Ticking a
 * parent grants and locks every action under it. You can only give what you hold (`held`;
 * null means everything), counting a parent you hold as holding its children.
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
  const set = (k: string, on: boolean) =>
    onChange(on ? [...value, k] : value.filter((x) => x !== k))

  const Row = ({ k, child }: { k: string; child?: boolean }) => {
    const allowed = grantable(k)
    const byParent = child && value.includes(parentOf(k)!)
    return (
      <label
        className={cn(
          "flex items-start gap-2 py-1",
          child && "ml-7",
          (!allowed || byParent) && "opacity-60"
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
          disabled={!allowed || byParent}
          checked={effectively(value, k)}
          onCheckedChange={(on) => set(k, on)}
        />
        <span>
          <span className="text-body-sm text-ink">{info(k).label}</span>
          <span className="block text-xs text-body">{info(k).description}</span>
        </span>
      </label>
    )
  }

  return (
    <div className="grid gap-4">
      {modules.map((module) => (
        <fieldset key={module} className="grid gap-0.5">
          <legend className="mb-1 text-caption-upper text-body uppercase">
            {module}
          </legend>
          {tops(module).map((parent) => {
            const kids = childrenOf(parent)
            if (kids.length === 0) return <Row key={parent} k={parent} />
            const chosen = kids.filter((k) => value.includes(k)).length
            const expanded = open[parent] ?? false
            const summary = value.includes(parent)
              ? "All actions"
              : chosen > 0
                ? `${chosen} of ${kids.length}`
                : null
            return (
              <div key={parent} className="rounded-md">
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} the actions under ${info(parent).label}`}
                    onClick={() =>
                      setOpen((o) => ({ ...o, [parent]: !expanded }))
                    }
                    className="mt-1.5 rounded p-0.5 text-body hover:bg-muted"
                  >
                    <CaretRightIcon
                      className={cn(
                        "size-3.5 transition-transform",
                        expanded && "rotate-90"
                      )}
                    />
                  </button>
                  <div className="flex-1">
                    <Row k={parent} />
                  </div>
                  {summary && (
                    <span className="mt-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                      {summary}
                    </span>
                  )}
                </div>
                {expanded && (
                  <div className="border-l border-hairline pl-1">
                    {kids.map((k) => (
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
