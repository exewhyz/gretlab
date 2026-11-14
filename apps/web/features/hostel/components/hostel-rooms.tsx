"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
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
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import { Card, Loading } from "@/features/admin/components/shell"
import type {
  addRooms,
  hostelRoomsList,
  searchResidents,
} from "@/features/hostel/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { Bed, Hostel, Room, Setup } from "./hostel-parts"

export function HostelRooms({
  slug,
  hostel,
  can,
  onEdit,
  onAddRooms,
  onChange,
}: {
  slug: string
  hostel: Hostel
  can: Setup["can"]
  onEdit: () => void
  onAddRooms: () => void
  onChange: () => void
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "hostel-rooms", hostel.id],
    queryFn: () =>
      api<ApiResult<typeof hostelRoomsList>>(
        `/orgs/${slug}/hostel/${hostel.id}/rooms`
      ),
  })
  const [find, setFind] = useState("")
  const [bed, setBed] = useState<{ room: Room; bed: Bed } | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const remove = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/hostel/${hostel.id}`, { method: "DELETE" }),
    onSuccess: onChange,
  })
  const term = find.trim().toLowerCase()
  const rooms = (data?.rooms ?? []).filter(
    (r) =>
      !term ||
      r.name.toLowerCase().includes(term) ||
      r.beds.some((b) => b.resident?.name.toLowerCase().includes(term))
  )
  return (
    <section aria-label={hostel.name} className="grid gap-3">
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["Rooms", hostel.rooms],
            ["Beds taken", hostel.taken],
            ["Beds free", hostel.beds - hostel.taken],
          ] as const
        ).map(([label, n]) => (
          <Card key={label}>
            <div className="text-caption text-body">{label}</div>
            <div className="text-display-sm text-ink">{n}</div>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-body">
        <span>
          {[
            hostel.forWhom && `For ${hostel.forWhom}`,
            hostel.warden && `Warden ${hostel.warden}`,
            hostel.wardenPhone,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {can.rooms && (
          <div className="ml-auto flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={onAddRooms}>
              Add rooms
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit hostel
            </Button>
            <ConfirmButton
              size="sm"
              variant="ghost"
              title={`Remove ${hostel.name}?`}
              description="Its rooms and beds go too. Only an empty hostel can be removed."
              confirmLabel="Remove"
              onConfirm={() => remove.mutate()}
            >
              Remove
            </ConfirmButton>
          </div>
        )}
      </div>
      {remove.error && (
        <FormMessage message={{ text: remove.error.message, kind: "err" }} />
      )}
      {data && data.rooms.length > 0 && (
        <TextInput
          aria-label="Find a room or resident"
          placeholder="Find a room or resident"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          className="max-w-sm"
        />
      )}
      {!data ? (
        <Loading error={error} />
      ) : data.rooms.length === 0 ? (
        <p className="text-body-sm text-body">No rooms yet.</p>
      ) : (
        <ul
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="rooms"
        >
          {rooms.map((r) => (
            <li
              key={r.id}
              data-testid="room"
              className="grid gap-2 rounded-lg border border-hairline bg-card p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-title-sm text-ink">{r.name}</span>
                  {r.floor && (
                    <span className="text-xs text-body">
                      {" "}
                      · floor {r.floor}
                    </span>
                  )}
                </div>
                {can.rooms && (
                  <button
                    type="button"
                    className="text-caption text-body hover:text-ink"
                    onClick={() => setRoom(r)}
                  >
                    Edit
                  </button>
                )}
              </div>
              <ul className="grid gap-1">
                {r.beds.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      data-testid={`bed-${r.name}-${b.label}`}
                      disabled={
                        !can.allot || (b.taken && !b.resident?.canChange)
                      }
                      onClick={() => setBed({ room: r, bed: b })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-body-sm",
                        b.taken
                          ? "border-hairline bg-muted/50"
                          : "border-dashed border-hairline hover:border-ink/40",
                        "disabled:cursor-default"
                      )}
                    >
                      <span className="w-6 shrink-0 font-medium text-ink">
                        {b.label}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          b.taken ? "text-ink" : "text-body"
                        )}
                      >
                        {b.taken ? (b.resident?.name ?? "Taken") : "Free"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {bed && (
        <BedDialog
          slug={slug}
          hostel={hostel}
          room={bed.room}
          bed={bed.bed}
          onDone={(changed) => (setBed(null), changed && onChange())}
        />
      )}
      {room && (
        <RoomDialog
          slug={slug}
          room={room}
          onDone={(changed) => (setRoom(null), changed && onChange())}
        />
      )}
    </section>
  )
}

export type Candidate = ApiResult<typeof searchResidents>[number]

export function BedDialog({
  slug,
  hostel,
  room,
  bed,
  onDone,
}: {
  slug: string
  hostel: Hostel
  room: Room
  bed: Bed
  onDone: (changed: boolean) => void
}) {
  const [q, setQ] = useState("")
  const found = useQuery({
    queryKey: ["org", slug, "hostel-search", q.trim()],
    queryFn: () =>
      api<Candidate[]>(
        `/orgs/${slug}/hostel/residents/search?q=${encodeURIComponent(q.trim())}`
      ),
    enabled: !bed.taken && q.trim().length >= 2,
  })
  const allot = useMutation({
    mutationFn: (userId: string) =>
      api(`/orgs/${slug}/hostel/residents`, {
        body: { userId, bedId: bed.id },
      }),
    onSuccess: () => onDone(true),
  })
  const out = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/hostel/residents/${bed.resident!.id}`, {
        method: "DELETE",
      }),
    onSuccess: () => onDone(true),
  })
  const error = allot.error ?? out.error
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Room {room.name}, bed {bed.label}
          </DialogTitle>
          <DialogDescription>{hostel.name}</DialogDescription>
        </DialogHeader>
        {bed.resident ? (
          <div className="grid gap-1 text-body-sm">
            <div className="font-medium text-ink">{bed.resident.name}</div>
            <div className="text-xs text-body">
              {bed.resident.classes.join(", ")}
            </div>
            <p className="mt-2 text-xs text-body">
              To move them, open a free bed and choose them there.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Field label="Give this bed to">
              <TextInput
                placeholder="Name or email"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </Field>
            {q.trim().length >= 2 && (
              <ul
                className="max-h-56 overflow-y-auto rounded-md border border-hairline"
                aria-label="Members found"
              >
                {(found.data ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={allot.isPending}
                      className="w-full px-3 py-2 text-left text-body-sm hover:bg-muted"
                      onClick={() => allot.mutate(c.id)}
                    >
                      <span className="font-medium text-ink">{c.name}</span>{" "}
                      <span className="text-xs text-body">
                        {c.classes.join(", ") || c.email}
                        {c.now && ` · now ${c.now}`}
                      </span>
                    </button>
                  </li>
                ))}
                {found.data?.length === 0 && (
                  <li className="px-3 py-2 text-body-sm text-body">
                    Nobody you can allot matches.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
        {error && (
          <FormMessage message={{ text: error.message, kind: "err" }} />
        )}
        <DialogFooter>
          {bed.resident?.canChange && (
            <ConfirmButton
              variant="outline"
              title={`Move ${bed.resident.name} out?`}
              description="The bed becomes free."
              confirmLabel="Move out"
              onConfirm={() => out.mutate()}
            >
              Move out
            </ConfirmButton>
          )}
          <Button variant="ghost" onClick={() => onDone(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AddRoomsDialog({
  slug,
  hostel,
  onDone,
}: {
  slug: string
  hostel: Hostel
  onDone: (changed: boolean) => void
}) {
  const [form, setForm] = useState({
    prefix: "",
    from: "101",
    to: "110",
    floor: "1",
    beds: "2",
  })
  const save = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof addRooms>>(
        `/orgs/${slug}/hostel/${hostel.id}/rooms`,
        {
          body: {
            prefix: form.prefix,
            from: Number(form.from),
            to: Number(form.to),
            floor: form.floor,
            beds: Number(form.beds),
          },
        }
      ),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  const n = Number(form.to) - Number(form.from) + 1
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onDone(Boolean(save.data?.added))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add rooms to {hostel.name}</DialogTitle>
          <DialogDescription>
            A run of rooms on one floor, each with the same beds. Rooms already
            there are skipped.
          </DialogDescription>
        </DialogHeader>
        {save.data ? (
          <p className="text-body-sm text-ink" data-testid="rooms-report">
            Added {save.data.added} rooms
            {save.data.skipped
              ? `; ${save.data.skipped} were already there.`
              : "."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name before the number" help='e.g. "A-" for A-101'>
              <TextInput value={form.prefix} onChange={set("prefix")} />
            </Field>
            <Field label="From">
              <TextInput
                type="number"
                min={0}
                value={form.from}
                onChange={set("from")}
              />
            </Field>
            <Field label="To">
              <TextInput
                type="number"
                min={0}
                value={form.to}
                onChange={set("to")}
              />
            </Field>
            <Field label="Floor">
              <TextInput value={form.floor} onChange={set("floor")} />
            </Field>
            <Field label="Beds in each">
              <TextInput
                type="number"
                min={1}
                max={40}
                value={form.beds}
                onChange={set("beds")}
              />
            </Field>
          </div>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          {save.data ? (
            <Button onClick={() => onDone(save.data!.added > 0)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button
                disabled={!(n > 0) || save.isPending}
                onClick={() => save.mutate()}
              >
                Add {n > 0 ? n : ""} rooms
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RoomDialog({
  slug,
  room,
  onDone,
}: {
  slug: string
  room: Room
  onDone: (changed: boolean) => void
}) {
  const [form, setForm] = useState({
    name: room.name,
    floor: room.floor,
    beds: String(room.beds.length),
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/hostel/rooms/${room.id}`, {
        method: "PUT",
        body: { ...form, beds: Number(form.beds) },
      }),
    onSuccess: () => onDone(true),
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/hostel/rooms/${room.id}`, { method: "DELETE" }),
    onSuccess: () => onDone(true),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  const error = save.error ?? remove.error
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Room {room.name}</DialogTitle>
          <DialogDescription>
            Fewer beds removes the last letters; an occupied bed can&apos;t be
            removed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <TextInput value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Floor">
            <TextInput value={form.floor} onChange={set("floor")} />
          </Field>
          <Field label="Beds">
            <TextInput
              type="number"
              min={1}
              max={40}
              value={form.beds}
              onChange={set("beds")}
            />
          </Field>
        </div>
        {error && (
          <FormMessage message={{ text: error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <ConfirmButton
            variant="outline"
            title={`Remove room ${room.name}?`}
            description="Only an empty room can be removed."
            confirmLabel="Remove"
            onConfirm={() => remove.mutate()}
          >
            Remove room
          </ConfirmButton>
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
