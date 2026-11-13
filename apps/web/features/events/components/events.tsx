"use client"

import { CalendarBlankIcon, MapPinIcon, VideoCameraIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { KindTerms } from "@workspace/judge"
import Link from "next/link"
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
import { Field, FormMessage, SelectInput, TextArea, TextInput } from "@/components/form"
import { Card, Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

/*
 * Events: the organization's meetups, workshops and talks. Members say they're going (or
 * join the waitlist when it's full); those who run events create and change them, see
 * who's coming and cancel them.
 */

export interface EventView {
  id: string
  title: string
  description: string
  startsAt: string
  endsAt: string
  location: string
  online: boolean
  link: string | null
  capacity: number | null
  group: { id: string; name: string } | null
  going: number
  waiting: number
  full: boolean
  cancelled: boolean
  mine: "going" | "waitlist" | "not_going" | null
  canManage: boolean
}

interface List {
  terms: KindTerms
  noun: string
  events: EventView[]
  canCreate: boolean
  audiences: { id: string | null; name: string }[]
}

/** "Sat 21 Nov, 6:00 – 8:00 PM" in the viewer's own timezone. */
export function eventWhen(e: { startsAt: string; endsAt: string }) {
  const s = new Date(e.startsAt)
  const end = new Date(e.endsAt)
  const day = s.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  return s.toDateString() === end.toDateString()
    ? `${day}, ${time(s)} – ${time(end)}`
    : `${day}, ${time(s)} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time(end)}`
}

function places(e: EventView) {
  if (e.capacity == null) return `${e.going} going`
  return e.full
    ? `Full · ${e.going} going${e.waiting ? `, ${e.waiting} waiting` : ""}`
    : `${e.capacity - e.going} of ${e.capacity} places left`
}

export function MyAnswer({ e }: { e: EventView }) {
  if (e.mine === "going")
    return (
      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success" data-testid="my-rsvp">
        Going
      </span>
    )
  if (e.mine === "waitlist")
    return (
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-active" data-testid="my-rsvp">
        Waitlist
      </span>
    )
  return null
}

/** An event in a list: when, where, places, and your answer. */
export function EventCard({ slug, e }: { slug: string; e: EventView }) {
  return (
    <Link
      href={`/orgs/${slug}/events/${e.id}`}
      data-testid="event-card"
      className={cn(
        "grid gap-1.5 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10 transition-colors hover:bg-muted/40",
        e.cancelled && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn("font-semibold text-ink", e.cancelled && "line-through")}>{e.title}</span>
        {e.cancelled ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Cancelled</span>
        ) : (
          <MyAnswer e={e} />
        )}
      </div>
      <span className="flex items-center gap-1.5 text-body-sm text-body">
        <CalendarBlankIcon className="size-4 shrink-0" aria-hidden />
        {eventWhen(e)}
      </span>
      <span className="flex items-center gap-1.5 text-body-sm text-body">
        {e.location ? (
          <MapPinIcon className="size-4 shrink-0" aria-hidden />
        ) : (
          <VideoCameraIcon className="size-4 shrink-0" aria-hidden />
        )}
        {e.location || "Online"}
      </span>
      <span className="text-caption">
        {places(e)}
        {e.group && ` · ${e.group.name}`}
      </span>
    </Link>
  )
}

export function EventsPage({ slug }: { slug: string }) {
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming")
  const { data, error } = useQuery({
    queryKey: ["org", slug, "events", when],
    queryFn: () => api<List>(`/orgs/${slug}/events?when=${when}`),
  })
  const [creating, setCreating] = useState(false)
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle action={data.canCreate && <Button onClick={() => setCreating(true)}>New event</Button>}>
        Events
      </PageTitle>
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Events">
        {(["upcoming", "past"] as const).map((w) => (
          <Button
            key={w}
            size="sm"
            role="tab"
            aria-selected={when === w}
            variant={when === w ? "default" : "outline"}
            onClick={() => setWhen(w)}
          >
            {w === "upcoming" ? "Upcoming" : "Past"}
          </Button>
        ))}
      </div>
      {data.events.length === 0 ? (
        <Card>
          <p data-testid="no-events">
            {when === "upcoming" ? "Nothing coming up." : "No past events."}
            {when === "upcoming" && data.canCreate && " Make the first one with New event."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="events">
          {data.events.map((e) => (
            <EventCard key={e.id} slug={slug} e={e} />
          ))}
        </div>
      )}
      {creating && <EventDialog slug={slug} audiences={data.audiences} onClose={() => setCreating(false)} />}
    </>
  )
}

/** A Date as a datetime-local input's value, in the viewer's timezone. */
const local = (iso: string) => {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function EventDialog({
  slug,
  audiences,
  event,
  onClose,
}: {
  slug: string
  audiences: List["audiences"]
  event?: EventView
  onClose: () => void
}) {
  const client = useQueryClient()
  const [f, setF] = useState({
    title: event?.title ?? "",
    description: event?.description ?? "",
    startsAt: event ? local(event.startsAt) : "",
    endsAt: event ? local(event.endsAt) : "",
    location: event?.location ?? "",
    link: event?.link ?? "",
    capacity: event?.capacity ? String(event.capacity) : "",
    groupId: event?.group?.id ?? (audiences[0]?.id ?? ""),
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: () =>
      api<EventView>(event ? `/orgs/${slug}/events/${event.id}` : `/orgs/${slug}/events`, {
        method: event ? "PUT" : "POST",
        body: {
          title: f.title,
          description: f.description,
          startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : "",
          endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : "",
          location: f.location,
          link: f.link,
          capacity: f.capacity ? Number(f.capacity) : null,
          groupId: f.groupId || null,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug, "events"] })
      void client.invalidateQueries({ queryKey: ["org", slug, "event"] })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Change event" : "New event"}</DialogTitle>
          <DialogDescription>
            {event
              ? "Everyone coming is told if its time or place changes."
              : "Members it's for see it on their home and say whether they're coming."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="event-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Title">
            <TextInput value={f.title} onChange={set("title")} placeholder="Intro to Rust: hands-on evening" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts">
              <TextInput type="datetime-local" value={f.startsAt} onChange={set("startsAt")} />
            </Field>
            <Field label="Ends">
              <TextInput type="datetime-local" value={f.endsAt} onChange={set("endsAt")} />
            </Field>
          </div>
          <Field label="Place" help="Leave empty for online only.">
            <TextInput value={f.location} onChange={set("location")} placeholder="Room 204, Main building" />
          </Field>
          <Field label="Online link" help="Only people going see it.">
            <TextInput type="url" value={f.link} onChange={set("link")} placeholder="https://meet.example.com/…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Places" help="Empty for no limit.">
              <TextInput type="number" min={1} value={f.capacity} onChange={set("capacity")} />
            </Field>
            {!event && (
              <Field label="For">
                <SelectInput value={f.groupId} onChange={set("groupId")}>
                  {audiences.map((a) => (
                    <option key={a.id ?? "all"} value={a.id ?? ""}>
                      {a.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}
          </div>
          <Field label="About it">
            <TextArea rows={3} value={f.description} onChange={set("description")} />
          </Field>
        </form>
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="event-form" disabled={!f.title.trim() || save.isPending}>
            {event ? "Save" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Detail = EventView & { people: { name: string; email: string; status: "going" | "waitlist" }[] | null }

export function EventPage({ slug, id }: { slug: string; id: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "event", id]
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api<Detail>(`/orgs/${slug}/events/${id}`) })
  const [editing, setEditing] = useState(false)
  const answer = useMutation({
    mutationFn: (going: boolean) => api<Detail>(`/orgs/${slug}/events/${id}/rsvp`, { method: "PUT", body: { going } }),
    onSuccess: (next) => {
      client.setQueryData(key, next)
      void client.invalidateQueries({ queryKey: ["org", slug, "events"] })
      void client.invalidateQueries({ queryKey: ["org", slug, "home"] })
    },
  })
  const cancel = useMutation({
    mutationFn: () => api(`/orgs/${slug}/events/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["org", slug] }),
  })
  if (!data) return <Loading error={error} />
  const over = new Date(data.endsAt) < new Date()
  const coming = data.mine === "going" || data.mine === "waitlist"
  return (
    <div className="grid max-w-3xl gap-4" data-testid="event-page">
      <div>
        <Link href={`/orgs/${slug}/events`} className="text-body-sm text-primary hover:underline">
          All events
        </Link>
        <h1 className={cn("mt-1 text-display-sm text-ink", data.cancelled && "line-through")}>{data.title}</h1>
      </div>
      {data.cancelled && (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-body-sm text-destructive">
          This event was cancelled.
        </p>
      )}
      <Card className="grid gap-2">
        <span className="flex items-center gap-2 text-ink">
          <CalendarBlankIcon className="size-4" aria-hidden />
          {eventWhen(data)}
        </span>
        {data.location && (
          <span className="flex items-center gap-2 text-ink">
            <MapPinIcon className="size-4" aria-hidden />
            {data.location}
          </span>
        )}
        {data.online && (
          <span className="flex items-center gap-2 text-ink" data-testid="event-link">
            <VideoCameraIcon className="size-4" aria-hidden />
            {data.link ? (
              <a href={data.link} target="_blank" rel="noreferrer" className="text-primary underline">
                Join online
              </a>
            ) : (
              <span className="text-body">Online: the link shows once you&apos;re going</span>
            )}
          </span>
        )}
        <span className="text-caption" data-testid="event-places">
          {places(data)}
          {data.group && ` · For ${data.group.name}`}
        </span>
        {data.description && <p className="whitespace-pre-wrap text-body-sm text-body">{data.description}</p>}
      </Card>
      {!data.cancelled && !over && (
        <div className="flex flex-wrap items-center gap-3">
          {coming ? (
            <>
              <MyAnswer e={data} />
              <span className="text-body-sm text-body">
                {data.mine === "waitlist"
                  ? "You're on the waitlist: you'll be told if a place comes free."
                  : "You're going."}
              </span>
              <Button variant="outline" disabled={answer.isPending} onClick={() => answer.mutate(false)}>
                {data.mine === "waitlist" ? "Leave the waitlist" : "I can't go"}
              </Button>
            </>
          ) : (
            <Button disabled={answer.isPending} onClick={() => answer.mutate(true)}>
              {data.full ? "Join the waitlist" : "I'm going"}
            </Button>
          )}
        </div>
      )}
      {(answer.error ?? cancel.error) && (
        <FormMessage message={{ text: (answer.error ?? cancel.error)!.message, kind: "err" }} />
      )}
      {data.canManage && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-title-md font-semibold text-ink">Who&apos;s coming</h2>
            {!data.cancelled && !over && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Change
                </Button>
                <ConfirmButton
                  variant="outline"
                  size="sm"
                  title={`Cancel ${data.title}?`}
                  description="Everyone going or waiting is told. It stays listed, marked cancelled."
                  confirmLabel="Cancel the event"
                  onConfirm={() => cancel.mutate()}
                >
                  Cancel event
                </ConfirmButton>
              </div>
            )}
          </div>
          {data.people && data.people.length > 0 ? (
            <Table headers={["Name", "Email", ""]}>
              {data.people.map((p) => (
                <tr key={p.email} data-testid="attendee">
                  <td>{p.name}</td>
                  <td className="text-body">{p.email}</td>
                  <td>{p.status === "waitlist" ? "Waitlist" : "Going"}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Card>Nobody yet.</Card>
          )}
        </section>
      )}
      {editing && (
        <EventDialog slug={slug} audiences={[]} event={data} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}
