"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"

import { Loading, PageTitle, Table } from "./shell"

interface Unit {
  id: string
  name: string
  position: number
  problems: { id: string; slug: string; title: string; published: boolean }[]
}

interface Units {
  units: Unit[]
  unplaced: number
  problems: (Unit["problems"][number] & { unitId: string | null })[]
}

const KEY = ["admin", "units"]

/**
 * The platform's course outline: units in the order the library shows them, each with its
 * problems in order. A compact list; each unit is edited in a dialog.
 */
export function AdminUnits() {
  const client = useQueryClient()
  const { data, error } = useQuery({ queryKey: KEY, queryFn: () => api<Units>("/admin/units") })
  const [name, setName] = useState("")
  const [editing, setEditing] = useState<Unit | null>(null)
  const [deleting, setDeleting] = useState<Unit | null>(null)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: KEY })
    void client.invalidateQueries({ queryKey: ["admin", "problems"] })
  }
  const add = useMutation({
    mutationFn: () => api("/admin/units", { body: { name } }),
    onSuccess: () => {
      setName("")
      refresh()
    },
  })
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api("/admin/units", { method: "PUT", body: { ids } }),
    onSuccess: refresh,
  })
  if (!data) return <Loading error={error} />
  const move = (index: number, delta: -1 | 1) => {
    const ids = data.units.map((u) => u.id)
    const [id] = ids.splice(index, 1)
    if (id) ids.splice(index + delta, 0, id)
    reorder.mutate(ids)
  }
  return (
    <>
      <PageTitle>Units</PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        The course outline of the problem library: units in order, and the problems inside
        each.
        {data.unplaced > 0 && ` ${data.unplaced} problems are in no unit.`} Add, remove and
        move problems from a unit's Edit.
      </p>
      <form
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) add.mutate()
        }}
      >
        <TextInput
          aria-label="New unit"
          placeholder="New unit, e.g. Recursion"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || add.isPending}>
          Add unit
        </Button>
      </form>
      {(add.error || reorder.error) && (
        <FormMessage message={{ text: (add.error ?? reorder.error)!.message, kind: "err" }} />
      )}
      <Table headers={["", "Unit", "Problems", ""]}>
        {data.units.map((unit, index) => (
          <tr key={unit.id} data-testid="unit-row">
            <td className="w-12 tabular-nums text-body">{index + 1}</td>
            <td className="text-ink">{unit.name}</td>
            <td className="max-w-96">
              <span className="block truncate" title={unit.problems.map((p) => p.title).join("\n")}>
                {unit.problems.length}{" "}
                <span className="text-body">
                  {unit.problems.length
                    ? `· ${unit.problems.map((p) => p.title).join(", ")}`
                    : "problems"}
                </span>
              </span>
            </td>
            <td className="w-64 text-right whitespace-nowrap">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${unit.name} up`}
                disabled={index === 0 || reorder.isPending}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${unit.name} down`}
                disabled={index === data.units.length - 1 || reorder.isPending}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="ml-2"
                aria-label={`Edit ${unit.name}`}
                onClick={() => setEditing(unit)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-1 text-destructive"
                aria-label={`Delete ${unit.name}`}
                onClick={() => setDeleting(unit)}
              >
                Delete
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {data.units.length === 0 && (
        <p className="mt-3 text-body-sm text-body">No units yet.</p>
      )}
      {editing && (
        <UnitDialog
          key={editing.id}
          unit={editing}
          units={data.units}
          all={data.problems}
          onDone={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
      {deleting && (
        <DeleteUnitDialog
          key={deleting.id}
          unit={deleting}
          others={data.units.filter((u) => u.id !== deleting.id)}
          onDone={() => {
            setDeleting(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

/**
 * A unit: its name, which problems are in it and their order. Problems can be added from
 * anywhere, moved to another unit or to none; nothing changes until Save.
 */
function UnitDialog({
  unit,
  units,
  all,
  onDone,
}: {
  unit: Unit
  units: Unit[]
  all: Units["problems"]
  onDone: () => void
}) {
  const [name, setName] = useState(unit.name)
  const [order, setOrder] = useState(unit.problems.map((p) => p.id))
  /** Problems leaving this unit → where they go (null: no unit). */
  const [moves, setMoves] = useState<Record<string, string | null>>({})
  const [search, setSearch] = useState("")
  const byId = new Map(all.map((p) => [p.id, p]))
  const unitName = (id: string | null) =>
    id ? (units.find((u) => u.id === id)?.name ?? "?") : "No unit"
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/units/${unit.id}`, {
        method: "PATCH",
        body: { name, problemIds: order, moves },
      }),
    onSuccess: onDone,
  })
  const move = (index: number, delta: -1 | 1) => {
    const next = [...order]
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + delta, 0, item)
    setOrder(next)
  }
  const sendAway = (id: string, to: string | null) => {
    setOrder((o) => o.filter((x) => x !== id))
    // Only problems that were here need a destination; one added and removed again just isn't added.
    if (unit.problems.some((p) => p.id === id)) setMoves((m) => ({ ...m, [id]: to }))
  }
  const bring = (id: string) => {
    setOrder((o) => [...o, id])
    setMoves((m) => {
      const { [id]: _, ...rest } = m
      return rest
    })
  }
  const query = search.trim().toLowerCase()
  const addable = all.filter(
    (p) =>
      !order.includes(p.id) &&
      !(p.id in moves) &&
      (!query || p.title.toLowerCase().includes(query) || p.slug.includes(query))
  )
  const leaving = Object.entries(moves)
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl" data-testid="unit-dialog">
        <DialogHeader>
          <DialogTitle>Edit unit</DialogTitle>
          <DialogDescription>
            Its name, which problems are in it, and the order the library shows them.
            Moving a problem here takes it out of its old unit. Nothing changes until you save.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name">
          <TextInput aria-label="Unit name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-3 min-[901px]:grid-cols-2">
          <div className="grid content-start gap-1 rounded-md border border-hairline p-2.5" data-testid="unit-problems">
            <div className="text-caption font-medium text-ink">
              In this unit, in order ({order.length})
            </div>
            {order.length === 0 && <p className="text-caption">None. Add some from the right.</p>}
            <ol className="grid max-h-80 gap-0.5 overflow-y-auto">
              {order.map((id, index) => {
                const p = byId.get(id)
                return (
                  <li
                    key={id}
                    data-testid="unit-problem"
                    className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-muted"
                  >
                    <span className="w-6 text-caption tabular-nums">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                      {p?.title ?? "?"}
                    </span>
                    {p && !p.published && <span className="text-xs text-body">Draft</span>}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${p?.title} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${p?.title} down`}
                      disabled={index === order.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                    <SelectInput
                      aria-label={`Move ${p?.title} to`}
                      className="w-28 py-0.5 text-xs"
                      value=""
                      onChange={(e) =>
                        e.target.value &&
                        sendAway(id, e.target.value === "none" ? null : e.target.value)
                      }
                    >
                      <option value="">Move to…</option>
                      {units
                        .filter((u) => u.id !== unit.id)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      <option value="none">No unit</option>
                    </SelectInput>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${p?.title} from the unit`}
                      onClick={() => sendAway(id, null)}
                    >
                      ✕
                    </Button>
                  </li>
                )
              })}
            </ol>
            {leaving.length > 0 && (
              <div className="mt-2 grid gap-0.5 border-t border-hairline pt-2" data-testid="unit-leaving">
                <div className="text-caption font-medium text-ink">Leaving this unit</div>
                {leaving.map(([id, to]) => (
                  <div key={id} className="flex items-center gap-2 px-1.5 text-body-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {byId.get(id)?.title} → <span className="text-body">{unitName(to)}</span>
                    </span>
                    <Button variant="link" size="xs" className="h-auto p-0" onClick={() => bring(id)}>
                      Undo
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid content-start gap-1.5 rounded-md border border-hairline p-2.5">
            <div className="text-caption font-medium text-ink">Add problems</div>
            <TextInput
              aria-label="Search problems to add"
              placeholder="Search problems"
              className="py-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="grid max-h-72 gap-0.5 overflow-y-auto">
              {addable.map((p) => (
                <li key={p.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Add ${p.title}`}
                    className="h-auto w-full justify-start gap-2 rounded-sm px-2 py-1 text-left text-body-sm font-normal whitespace-normal"
                    onClick={() => bring(p.id)}
                  >
                    <span className="flex-none text-muted-foreground">+</span>
                    <span className="min-w-0 flex-1 text-ink">{p.title}</span>
                    <span className="text-xs text-body">{unitName(p.unitId)}</span>
                  </Button>
                </li>
              ))}
              {addable.length === 0 && <li className="px-2 py-1 text-caption">Nothing matches.</li>}
            </ul>
          </div>
        </div>
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            Save unit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Deleting asks where its problems go: another unit, or none. */
function DeleteUnitDialog({
  unit,
  others,
  onDone,
}: {
  unit: Unit
  others: Unit[]
  onDone: () => void
}) {
  const [moveTo, setMoveTo] = useState("")
  const remove = useMutation({
    mutationFn: () =>
      api(`/admin/units/${unit.id}${moveTo ? `?moveTo=${moveTo}` : ""}`, { method: "DELETE" }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md" role="alertdialog">
        <DialogHeader>
          <DialogTitle>Delete {unit.name}?</DialogTitle>
          <DialogDescription>
            {unit.problems.length
              ? `Its ${unit.problems.length} problems aren't deleted; choose where they go.`
              : "It has no problems."}{" "}
            This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {unit.problems.length > 0 && (
          <Field label="Move its problems to">
            <SelectInput
              aria-label="Move its problems to"
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
            >
              <option value="">No unit</option>
              {others.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        {remove.error && <FormMessage message={{ text: remove.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete unit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
