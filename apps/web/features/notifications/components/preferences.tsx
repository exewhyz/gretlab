"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Checkbox } from "@workspace/ui/components/checkbox"

import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

interface Row {
  event: string
  label: string
  description: string
  audience: "students" | "parents" | "staff" | "everyone"
  on: boolean
  canChoose: boolean
  alwaysIn: string[]
  offIn: string[]
}

interface Data {
  mail: boolean
  emailOn: boolean
  events: Row[]
}

const KEY = ["me", "notifications", "settings"]

const list = (names: string[]) => names.join(", ")

/** Your notification settings: which events also email you. */
export function NotificationPreferences() {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api<Data>("/me/notifications/settings"),
  })
  const update = useMutation({
    mutationFn: (body: { email?: boolean; events?: Record<string, boolean> }) =>
      api<Data>("/me/notifications", { method: "PATCH", body }),
    onSuccess: (saved) => {
      client.setQueryData(KEY, saved)
      void client.invalidateQueries({
        queryKey: ["me", "notifications"],
        exact: true,
      })
    },
  })
  if (!data) return <Loading error={error} />
  const staff = data.events.filter((row) => row.audience === "staff")
  const mine = data.events.filter((row) => row.audience !== "staff")
  const group = (title: string, rows: Row[]) =>
    rows.length > 0 && (
      <section className="rounded-lg border border-hairline bg-card">
        <h2 className="border-b border-hairline px-4 py-2.5 text-caption-upper text-body uppercase">
          {title}
        </h2>
        <ul>
          {rows.map((row) => {
            const always = row.alwaysIn.length > 0 && !row.canChoose
            return (
              <li
                key={row.event}
                data-testid={`pref-${row.event}`}
                className="flex items-start gap-3 border-b border-hairline px-4 py-3 last:border-0"
              >
                <Checkbox
                  className="mt-0.5"
                  aria-label={`Email me: ${row.label}`}
                  checked={always || (row.canChoose && data.emailOn && row.on)}
                  disabled={!row.canChoose || !data.emailOn || update.isPending}
                  onCheckedChange={(on) =>
                    update.mutate({ events: { [row.event]: on } })
                  }
                />
                <div className="grid gap-0.5">
                  <span className="font-medium text-ink">{row.label}</span>
                  <span className="text-caption">{row.description}</span>
                  {row.alwaysIn.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Always emailed in {list(row.alwaysIn)}.
                    </span>
                  )}
                  {row.offIn.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Not emailed in {list(row.offIn)}.
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    )
  return (
    <div className="grid gap-4">
      {!data.mail && (
        <p
          role="status"
          className="rounded-md border border-hairline bg-muted/40 p-3 text-body-sm text-body"
        >
          Email isn't set up on this site yet. Your choices are kept for when it
          is.
        </p>
      )}
      <label className="flex items-start gap-3 rounded-lg border border-hairline bg-card px-4 py-3">
        <Checkbox
          className="mt-0.5"
          data-testid="pref-all-email"
          checked={data.emailOn}
          disabled={update.isPending}
          onCheckedChange={(on) => update.mutate({ email: on })}
        />
        <span className="grid gap-0.5">
          <span className="font-medium text-ink">Email me notifications</span>
          <span className="text-caption">
            Off stops all email except what an organization sends to everyone.
            Notifications still appear under the bell.
          </span>
        </span>
      </label>
      {group("Email me about", mine)}
      {group("As a teacher or member of staff", staff)}
    </div>
  )
}
