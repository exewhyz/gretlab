"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
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

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

interface Stop {
  id: string
  name: string
  pickup: string
  drop: string
  riders: number
}

interface Route {
  id: string
  name: string
  vehicle: string
  driver: string
  driverPhone: string
  capacity: number | null
  riders: number
  seatsLeft: number | null
  stops: Stop[]
}

interface Setup {
  can: { routes: boolean; assign: boolean }
  routes: Route[]
}

/** Manage › Transport: routes as cards; riders, edits and lists in dialogs. */
export function ManageTransport({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "transport"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Setup>(`/orgs/${slug}/transport`),
  })
  const [editing, setEditing] = useState<Route | "new" | null>(null)
  const [riding, setRiding] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/transport/routes/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />
  const refresh = () => client.invalidateQueries({ queryKey: ["org", slug] })
  const open = data.routes.find((r) => r.id === riding)
  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap gap-2">
            {data.can.assign && data.routes.length > 0 && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                Add riders from a list
              </Button>
            )}
            {data.can.routes && (
              <Button onClick={() => setEditing("new")}>Add route</Button>
            )}
          </div>
        }
      >
        Transport
      </PageTitle>
      {remove.error && (
        <FormMessage message={{ text: remove.error.message, kind: "err" }} />
      )}
      {data.routes.length === 0 ? (
        <p className="text-body-sm text-body">
          {data.can.routes
            ? "Add the first route with its stops."
            : "No routes yet."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="routes">
          {data.routes.map((r) => (
            <li
              key={r.id}
              data-testid="route"
              className="grid gap-2 rounded-lg border border-hairline bg-card p-4"
            >
              <div>
                <div className="text-title-sm text-ink">{r.name}</div>
                <div className="text-xs text-body">
                  {[r.vehicle, r.driver, r.driverPhone]
                    .filter(Boolean)
                    .join(" · ") || "No vehicle or driver yet"}
                </div>
              </div>
              <div className="text-body-sm text-body">
                {r.riders} rider{r.riders === 1 ? "" : "s"}
                {r.capacity != null && ` of ${r.capacity} seats`} ·{" "}
                {r.stops.length} stop
                {r.stops.length === 1 ? "" : "s"}
              </div>
              <ol className="text-xs text-body">
                {r.stops.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    {s.name}
                    {s.pickup && ` · ${s.pickup}`}
                  </li>
                ))}
                {r.stops.length > 4 && <li>and {r.stops.length - 4} more</li>}
              </ol>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRiding(r.id)}
                >
                  Riders
                </Button>
                {data.can.routes && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(r)}
                    >
                      Edit
                    </Button>
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      title={`Remove the ${r.name} route?`}
                      description={`Its ${r.riders} riders come off it.`}
                      confirmLabel="Remove"
                      onConfirm={() => remove.mutate(r.id)}
                    >
                      Remove
                    </ConfirmButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <RouteDialog
          slug={slug}
          route={editing === "new" ? null : editing}
          onDone={(changed) => (setEditing(null), changed && void refresh())}
        />
      )}
      {open && (
        <RidersDialog
          slug={slug}
          route={open}
          canAssign={data.can.assign}
          onClose={() => (setRiding(null), void refresh())}
        />
      )}
      {importing && (
        <ImportRiders
          slug={slug}
          onDone={(changed) => (setImporting(false), changed && void refresh())}
        />
      )}
    </>
  )
}

type StopDraft = { id?: string; name: string; pickup: string; drop: string }

function RouteDialog({
  slug,
  route,
  onDone,
}: {
  slug: string
  route: Route | null
  onDone: (changed: boolean) => void
}) {
  const [form, setForm] = useState({
    name: route?.name ?? "",
    vehicle: route?.vehicle ?? "",
    driver: route?.driver ?? "",
    driverPhone: route?.driverPhone ?? "",
    capacity: route?.capacity == null ? "" : String(route.capacity),
  })
  const [stops, setStops] = useState<StopDraft[]>(
    route?.stops.map(({ id, name, pickup, drop }) => ({
      id,
      name,
      pickup,
      drop,
    })) ?? [{ name: "", pickup: "", drop: "" }]
  )
  const save = useMutation({
    mutationFn: () =>
      api(
        route
          ? `/orgs/${slug}/transport/routes/${route.id}`
          : `/orgs/${slug}/transport`,
        {
          method: route ? "PUT" : "POST",
          body: {
            ...form,
            capacity: form.capacity ? Number(form.capacity) : null,
            stops,
          },
        }
      ),
    onSuccess: () => onDone(true),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  const change = (i: number, patch: Partial<StopDraft>) =>
    setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (i: number, by: number) => {
    const next = [...stops]
    const [s] = next.splice(i, 1)
    next.splice(i + by, 0, s!)
    setStops(next)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {route ? `Edit ${route.name}` : "Add route"}
          </DialogTitle>
          <DialogDescription>
            Stops in the order the bus picks up in the morning.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65dvh] gap-3 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Route name">
              <TextInput
                value={form.name}
                onChange={set("name")}
                placeholder="Route 3, Whitefield"
              />
            </Field>
            <Field label="Vehicle">
              <TextInput
                value={form.vehicle}
                onChange={set("vehicle")}
                placeholder="KA 01 AB 1234"
              />
            </Field>
            <Field label="Driver">
              <TextInput value={form.driver} onChange={set("driver")} />
            </Field>
            <Field label="Driver's phone">
              <TextInput
                value={form.driverPhone}
                onChange={set("driverPhone")}
              />
            </Field>
            <Field label="Seats" help="Leave empty for no limit.">
              <TextInput
                type="number"
                min={1}
                value={form.capacity}
                onChange={set("capacity")}
              />
            </Field>
          </div>
          <fieldset className="grid gap-2" data-testid="stops">
            <legend className="mb-1 text-caption font-semibold text-ink">
              Stops
            </legend>
            <div className="hidden grid-cols-[1fr_7rem_7rem_auto] gap-2 text-xs text-body sm:grid">
              <span>Name</span>
              <span>Pick-up</span>
              <span>Drop-off</span>
            </div>
            {stops.map((s, i) => (
              <div
                key={s.id ?? `new-${i}`}
                className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]"
              >
                <TextInput
                  className="col-span-2 sm:col-span-1"
                  aria-label={`Stop ${i + 1} name`}
                  value={s.name}
                  onChange={(e) => change(i, { name: e.target.value })}
                />
                <TextInput
                  aria-label={`Stop ${i + 1} pick-up`}
                  type="time"
                  value={s.pickup}
                  onChange={(e) => change(i, { pickup: e.target.value })}
                />
                <TextInput
                  aria-label={`Stop ${i + 1} drop-off`}
                  type="time"
                  value={s.drop}
                  onChange={(e) => change(i, { drop: e.target.value })}
                />
                <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                  <button
                    type="button"
                    aria-label={`Move stop ${i + 1} up`}
                    disabled={i === 0}
                    className="rounded p-1 text-body hover:bg-muted disabled:opacity-30"
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move stop ${i + 1} down`}
                    disabled={i === stops.length - 1}
                    className="rounded p-1 text-body hover:bg-muted disabled:opacity-30"
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove stop ${i + 1}`}
                    className="rounded p-1 text-body hover:bg-muted"
                    onClick={() => setStops(stops.filter((_, j) => j !== i))}
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setStops([...stops, { name: "", pickup: "", drop: "" }])
              }
            >
              <PlusIcon /> Add stop
            </Button>
          </fieldset>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button
            disabled={!form.name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Rider {
  id: string
  name: string
  email: string
  classes: string[]
  stopId: string
  canChange: boolean
}

interface Candidate {
  id: string
  name: string
  email: string
  classes: string[]
  route: string | null
}

function RidersDialog({
  slug,
  route,
  canAssign,
  onClose,
}: {
  slug: string
  route: Route
  canAssign: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const key = ["org", slug, "transport-riders", route.id]
  const riders = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Rider[]>(`/orgs/${slug}/transport/routes/${route.id}/riders`),
  })
  const [q, setQ] = useState("")
  const [stopId, setStopId] = useState(route.stops[0]?.id ?? "")
  const found = useQuery({
    queryKey: ["org", slug, "transport-search", q.trim()],
    queryFn: () =>
      api<Candidate[]>(
        `/orgs/${slug}/transport/riders/search?q=${encodeURIComponent(q.trim())}`
      ),
    enabled: canAssign && q.trim().length >= 2,
  })
  const done = () => {
    void client.invalidateQueries({ queryKey: key })
    void client.invalidateQueries({ queryKey: ["org", slug, "transport"] })
  }
  const assign = useMutation({
    mutationFn: (v: { userId: string; stopId: string }) =>
      api(`/orgs/${slug}/transport/riders`, {
        body: { routeId: route.id, ...v },
      }),
    onSuccess: () => (setQ(""), done()),
  })
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/orgs/${slug}/transport/riders/${userId}`, { method: "DELETE" }),
    onSuccess: done,
  })
  const error = assign.error ?? remove.error
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Riders of {route.name}</DialogTitle>
          <DialogDescription>
            {route.capacity == null
              ? "No seat limit."
              : `${route.seatsLeft} of ${route.capacity} seats free.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65dvh] gap-3 overflow-y-auto pr-1">
          {canAssign && route.stops.length > 0 && (
            <div className="grid gap-2 rounded-md border border-hairline p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                <TextInput
                  aria-label="Find a member"
                  placeholder="Add a rider: name or email"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <SelectInput
                  aria-label="Gets on at"
                  value={stopId}
                  onChange={(e) => setStopId(e.target.value)}
                >
                  {route.stops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SelectInput>
              </div>
              {q.trim().length >= 2 && (
                <ul
                  className="max-h-40 overflow-y-auto"
                  aria-label="Members found"
                >
                  {(found.data ?? []).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-body-sm hover:bg-muted"
                        disabled={assign.isPending}
                        onClick={() => assign.mutate({ userId: c.id, stopId })}
                      >
                        <span className="font-medium text-ink">{c.name}</span>{" "}
                        <span className="text-xs text-body">
                          {c.classes.join(", ") || c.email}
                          {c.route && ` · now on ${c.route}`}
                        </span>
                      </button>
                    </li>
                  ))}
                  {found.data?.length === 0 && (
                    <li className="px-2 py-1.5 text-body-sm text-body">
                      Nobody you can assign matches.
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
          {error && (
            <FormMessage message={{ text: error.message, kind: "err" }} />
          )}
          {!riders.data ? (
            <Loading error={riders.error} />
          ) : riders.data.length === 0 ? (
            <p className="text-body-sm text-body">
              Nobody rides this route yet.
            </p>
          ) : (
            <ul className="divide-y divide-hairline" data-testid="riders">
              {riders.data.map((r) => (
                <li
                  key={r.id}
                  data-testid="rider"
                  className="flex flex-wrap items-center gap-2 py-2 text-body-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">{r.name}</div>
                    <div className="truncate text-xs text-body">
                      {r.classes.join(", ") || r.email}
                    </div>
                  </div>
                  {r.canChange ? (
                    <>
                      <SelectInput
                        aria-label={`${r.name}'s stop`}
                        className="w-auto"
                        value={r.stopId}
                        onChange={(e) =>
                          assign.mutate({
                            userId: r.id,
                            stopId: e.target.value,
                          })
                        }
                      >
                        {route.stops.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </SelectInput>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(r.id)}
                      >
                        Take off
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-body">
                      {route.stops.find((s) => s.id === r.stopId)?.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportRiders({
  slug,
  onDone,
}: {
  slug: string
  onDone: (changed: boolean) => void
}) {
  const [text, setText] = useState("")
  const rows = text
    .split("\n")
    .map((line) =>
      (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) =>
        c.trim()
      )
    )
    .filter((c) => c.some(Boolean))
    .filter((c) => (c[0] ?? "").includes("@"))
    .map(([email = "", route = "", stop = ""]) => ({ email, route, stop }))
  const save = useMutation({
    mutationFn: () =>
      api<{
        placed: number
        failed: number
        report: { line: number; note: string }[]
      }>(`/orgs/${slug}/transport/riders/import`, {
        body: { rows },
      }),
  })
  const result = save.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onDone(Boolean(result?.placed))}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add riders from a list</DialogTitle>
          <DialogDescription>
            One per line: member email, route name, stop name.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-1 text-body-sm" data-testid="riders-report">
            <p className="text-ink">
              Placed {result.placed}
              {result.failed ? `; ${result.failed} not placed:` : "."}
            </p>
            <ul className="max-h-60 overflow-y-auto">
              {result.report.map((r) => (
                <li key={r.line} className="text-destructive">
                  Line {r.line}: {r.note}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-2">
            <TextArea
              aria-label="Riders list"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="asha@school.in, Route 3, Main Gate"
            />
            <p className="text-caption">{rows.length} riders</p>
            {save.error && (
              <FormMessage
                message={{ text: save.error.message, kind: "err" }}
              />
            )}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onDone(result.placed > 0)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button
                disabled={rows.length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                Place {rows.length || ""} riders
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
