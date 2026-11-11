"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { FormMessage } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

type Switch = "inApp" | "email" | "userChoice"
type Switches = Record<Switch, boolean>

interface Row {
  event: string
  label: string
  description: string
  audience: "students" | "staff" | "everyone"
  emailOnly: boolean
  own: Switches
  locked: Switches
}

interface Data {
  mail: boolean
  events: Row[]
}

const GROUPS: { audience: Row["audience"]; title: string }[] = [
  { audience: "students", title: "To students" },
  { audience: "everyone", title: "To anyone" },
  { audience: "staff", title: "To teachers and staff" },
]

const COLUMNS: { key: Switch; title: string }[] = [
  { key: "inApp", title: "In the app" },
  { key: "email", title: "Email" },
  { key: "userChoice", title: "People can turn its email off" },
]

/**
 * Which notifications a level allows: the platform's (Dashboard › Notifications) or an
 * organization's (Manage › Notifications). What the level above turned off shows as off and
 * can't be changed here.
 */
export function PolicyEditor({
  path,
  queryKey,
  level,
}: {
  /** The API path, such as /admin/notifications. */
  path: string
  queryKey: string[]
  level: "platform" | "organization"
}) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey,
    queryFn: () => api<Data>(path),
  })
  // Edits since the last save, by event; the rest shows what's stored.
  const [edits, setEdits] = useState<Record<string, Switches>>({})
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api<Data>(path, {
        method: "PUT",
        body: Object.fromEntries(
          (data?.events ?? []).map((row) => [
            row.event,
            edits[row.event] ?? row.own,
          ])
        ),
      }),
    onSuccess: (saved) => {
      client.setQueryData(queryKey, saved)
      setEdits({})
      setMessage({ text: "Saved.", kind: "ok" })
    },
    onError: (e: Error) => setMessage({ text: e.message, kind: "err" }),
  })
  if (!data) return <Loading error={error} />
  const changed = Object.keys(edits).length > 0
  const set = (row: Row, key: Switch, on: boolean) => {
    setMessage(null)
    setEdits((all) => ({
      ...all,
      [row.event]: { ...(all[row.event] ?? row.own), [key]: on },
    }))
  }
  return (
    <>
      <PageTitle
        action={
          <span className="flex items-center gap-3">
            <FormMessage message={message} />
            <Button
              disabled={!changed || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </span>
        }
      >
        Notifications
      </PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        {level === "platform"
          ? "Choose what the whole site may send. Each organization then chooses within this: what you turn off here, no organization can turn on."
          : "Choose what this organization sends its members. Anything the platform has turned off is shown as off and can't be changed here."}{" "}
        People choose for themselves in their own notification settings, where
        you let them.
      </p>
      {!data.mail && (
        <p
          role="status"
          className="mb-3 rounded-md border border-hairline bg-muted/40 p-3 text-body-sm text-body"
        >
          This server has no email provider set up, so nothing is emailed yet.
          Notifications still appear in the app.
        </p>
      )}
      <div className="grid gap-4">
        {GROUPS.map((group) => {
          const rows = data.events.filter(
            (row) => row.audience === group.audience
          )
          if (rows.length === 0) return null
          return (
            <section
              key={group.audience}
              className="overflow-x-auto rounded-lg border border-hairline bg-card"
            >
              <table className="w-full text-left text-body-sm text-ink">
                <thead>
                  <tr className="border-b border-hairline text-caption-upper text-body uppercase">
                    <th className="px-3 py-2.5">{group.title}</th>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className="w-28 px-3 py-2.5 text-center"
                      >
                        {column.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const own = edits[row.event] ?? row.own
                    return (
                      <tr
                        key={row.event}
                        data-testid={`policy-${row.event}`}
                        className="border-b border-hairline last:border-0"
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{row.label}</div>
                          <div className="text-caption">{row.description}</div>
                        </td>
                        {COLUMNS.map((column) => {
                          const locked = row.locked[column.key]
                          // No email, nothing to choose; an email-only event has no bell.
                          const pointless =
                            (column.key === "inApp" && row.emailOnly) ||
                            (column.key === "userChoice" &&
                              (!own.email || row.locked.email))
                          return (
                            <td
                              key={column.key}
                              className="px-3 py-2.5 text-center"
                            >
                              {column.key === "inApp" && row.emailOnly ? (
                                <span className="text-caption">Email only</span>
                              ) : (
                                <span className="inline-flex flex-col items-center gap-1">
                                  <Checkbox
                                    aria-label={`${row.label}: ${column.title}`}
                                    checked={
                                      !locked && !pointless && own[column.key]
                                    }
                                    disabled={locked || pointless}
                                    onCheckedChange={(on) =>
                                      set(row, column.key, on)
                                    }
                                  />
                                  {locked && (
                                    <span className="text-xs text-muted-foreground">
                                      Off for everyone
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </>
  )
}
