"use client"

import { useMutation } from "@tanstack/react-query"
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

import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import type { addHostel, importResidents } from "@/features/hostel/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { Hostel } from "./hostel-parts"

export function HostelDialog({
  slug,
  hostel,
  onDone,
}: {
  slug: string
  hostel: Hostel | null
  onDone: (id: string | null) => void
}) {
  const [form, setForm] = useState({
    name: hostel?.name ?? "",
    forWhom: hostel?.forWhom ?? "",
    warden: hostel?.warden ?? "",
    wardenPhone: hostel?.wardenPhone ?? "",
  })
  const save = useMutation({
    mutationFn: () =>
      hostel
        ? api(`/orgs/${slug}/hostel/${hostel.id}`, {
            method: "PUT",
            body: form,
          }).then(() => hostel.id)
        : api<ApiResult<typeof addHostel>>(`/orgs/${slug}/hostel`, {
            body: form,
          }).then((h) => h.id),
    onSuccess: (id) => onDone(id),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hostel ? `Edit ${hostel.name}` : "Add hostel"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={set("name")}
              placeholder="Tagore House"
            />
          </Field>
          <Field label="For" help="Boys, Girls, Staff… optional.">
            <TextInput value={form.forWhom} onChange={set("forWhom")} />
          </Field>
          <Field label="Warden">
            <TextInput value={form.warden} onChange={set("warden")} />
          </Field>
          <Field label="Warden's phone">
            <TextInput value={form.wardenPhone} onChange={set("wardenPhone")} />
          </Field>
        </div>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(null)}>
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

export function ImportResidents({
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
    .filter((c) => (c[0] ?? "").includes("@"))
    .map(([email = "", hostel = "", room = "", bed = ""]) => ({
      email,
      hostel,
      room,
      bed,
    }))
  const save = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof importResidents>>(
        `/orgs/${slug}/hostel/residents/import`,
        {
          body: { rows },
        }
      ),
  })
  const result = save.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onDone(Boolean(result?.allotted))}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Allot beds from a list</DialogTitle>
          <DialogDescription>
            One per line: member email, hostel, room, bed. Leave the bed out for
            the first free one.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div
            className="grid gap-1 text-body-sm"
            data-testid="residents-report"
          >
            <p className="text-ink">
              Allotted {result.allotted}
              {result.failed ? `; ${result.failed} not allotted:` : "."}
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
              aria-label="Residents list"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="asha@school.in, Tagore House, 101, A"
            />
            <p className="text-caption">{rows.length} residents</p>
            {save.error && (
              <FormMessage
                message={{ text: save.error.message, kind: "err" }}
              />
            )}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onDone(result.allotted > 0)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button
                disabled={rows.length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                Allot {rows.length || ""} beds
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
