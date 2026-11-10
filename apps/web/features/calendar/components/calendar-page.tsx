"use client"

import { CalendarBlankIcon, CopyIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useMemo, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Check, FormMessage, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

interface Event {
  id: string
  kind: "due" | "exam" | "contest" | "peer_review"
  title: string
  start: string
  end: string | null
  href: string
  detail: string
  done: boolean
}

const KIND: Record<Event["kind"], { label: string; tone: string }> = {
  due: { label: "Due", tone: "bg-primary/10 text-primary" },
  exam: { label: "Exam", tone: "bg-destructive/10 text-destructive" },
  contest: { label: "Contest", tone: "bg-muted text-ink" },
  peer_review: { label: "Reviews", tone: "bg-success/10 text-success" },
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA")
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

/** Everything with a date, by day, and the private feed for calendar apps. */
export function CalendarPage() {
  const { data, error } = useQuery({
    queryKey: ["me", "calendar"],
    queryFn: () => api<{ events: Event[]; feed: string | null }>("/me/calendar"),
  })
  const [past, setPast] = useState(false)
  const days = useMemo(() => {
    if (!data) return []
    const today = new Date().toLocaleDateString("en-CA")
    const shown = data.events.filter((e) => past || dayKey(e.end ?? e.start) >= today)
    const by = new Map<string, Event[]>()
    for (const e of shown) by.set(dayKey(e.start), [...(by.get(dayKey(e.start)) ?? []), e])
    return [...by.entries()]
  }, [data, past])
  if (!data) return <Loading error={error} />
  const today = new Date().toLocaleDateString("en-CA")
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display-lg text-ink">Calendar</h1>
          <p className="text-body-sm text-body">
            Due times (with your extensions), exams, peer reviews and your contests.
          </p>
        </div>
        <Check checked={past} onCheckedChange={setPast} label="Show past" />
      </div>
      <Feed feed={data.feed} />
      {days.length === 0 ? (
        <p className="text-body-sm text-body">Nothing coming up.</p>
      ) : (
        <ol className="grid gap-4" data-testid="agenda">
          {days.map(([day, events]) => (
            <li key={day} className="grid gap-1.5">
              <h2 className={cn("text-body-sm font-semibold", day === today ? "text-primary" : "text-ink")}>
                {day === today
                  ? "Today"
                  : new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
                    })}
              </h2>
              <ul className="grid gap-1">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={e.href}
                      data-testid="calendar-event"
                      className={cn(
                        "flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-card px-3 py-2 hover:bg-muted/50",
                        e.done && "opacity-60"
                      )}
                    >
                      <span className="w-20 text-caption tabular-nums">
                        {time(e.start)}
                        {e.end && dayKey(e.end) === day && `–${time(e.end)}`}
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", KIND[e.kind].tone)}>
                        {KIND[e.kind].label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm text-ink">{e.title}</span>
                        <span className="block truncate text-caption">{e.detail}</span>
                      </span>
                      {e.done && <span className="text-caption">Done</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Feed({ feed }: { feed: string | null }) {
  const client = useQueryClient()
  const [copied, setCopied] = useState(false)
  const done = () => client.invalidateQueries({ queryKey: ["me", "calendar"] })
  const rotate = useMutation({ mutationFn: () => api("/me/calendar/feed", { body: {} }), onSuccess: done })
  const remove = useMutation({
    mutationFn: () => api("/me/calendar/feed", { method: "DELETE" }),
    onSuccess: done,
  })
  const url = feed ? `${window.location.origin}/api/v1/calendar/${feed}.ics` : null
  return (
    <section className="grid gap-2 rounded-lg border border-hairline bg-card p-3" data-testid="calendar-feed">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarBlankIcon className="size-5 text-body" />
        <span className="flex-1 text-body-sm text-ink">
          {url
            ? "Your calendar's private address. Add it in Google Calendar (Other calendars › From URL), Outlook or Apple Calendar."
            : "See these in Google Calendar, Outlook or Apple Calendar, kept up to date."}
        </span>
        {!url && (
          <Button size="sm" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            Get calendar link
          </Button>
        )}
      </div>
      {url && (
        <div className="flex flex-wrap items-center gap-2">
          <TextInput aria-label="Calendar link" readOnly value={url} className="min-w-0 flex-1 font-mono text-xs" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(url)
              setCopied(true)
            }}
          >
            <CopyIcon /> {copied ? "Copied" : "Copy"}
          </Button>
          <ConfirmButton
            size="sm"
            variant="ghost"
            title="Make a new link?"
            description="The old link stops working; calendars using it need the new one."
            confirmLabel="New link"
            tone="default"
            onConfirm={() => {
              setCopied(false)
              rotate.mutate()
            }}
          >
            New link
          </ConfirmButton>
          <ConfirmButton
            size="sm"
            variant="ghost"
            title="Turn off the calendar link?"
            description="Calendars using it stop updating."
            confirmLabel="Turn off"
            onConfirm={() => remove.mutate()}
          >
            Turn off
          </ConfirmButton>
        </div>
      )}
      {url && (
        <p className="text-caption">
          Anyone with this link sees your due dates and contests (never marks or code). Make a
          new one if you shared it by mistake.
        </p>
      )}
      {(rotate.error ?? remove.error) && (
        <FormMessage message={{ text: (rotate.error ?? remove.error)!.message, kind: "err" }} />
      )}
    </section>
  )
}
