"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  grantsPlatformPermission,
  type PlatformPermission,
} from "@workspace/judge"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
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
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import {
  Card,
  Loading,
  PageTitle,
  Stats,
  Table,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDateTime } from "@/lib/format"
import type { listJudges } from "@/features/judges/server"

type Judges = ApiResult<typeof listJudges>
type Machine = Judges["machines"][number]

const KEY = ["admin", "judges"]

/** What each stage means to someone watching. */
const STAGES: Record<
  Machine["stage"],
  { label: string; tone: "default" | "secondary" | "destructive" | "outline" }
> = {
  requested: { label: "Requested", tone: "outline" },
  launching: { label: "Starting the machine", tone: "secondary" },
  installing: { label: "Installing the judge", tone: "secondary" },
  ready: { label: "Ready", tone: "default" },
  draining: { label: "Finishing its work", tone: "secondary" },
  drained: { label: "Done, ending", tone: "secondary" },
  stopping: { label: "Ending", tone: "secondary" },
  stopped: { label: "Stopped", tone: "outline" },
  failed: { label: "Failed", tone: "destructive" },
}
const CHANGING = new Set<Machine["stage"]>([
  "requested",
  "launching",
  "installing",
  "draining",
  "drained",
  "stopping",
])
const LIVE = new Set<Machine["stage"]>([...CHANGING, "ready"])

export function JudgesPage() {
  const client = useQueryClient()
  const { data: viewer } = useViewer()
  const held = viewer?.user?.platform.permissions ?? []
  const can = (p: PlatformPermission) => grantsPlatformPermission(held, p)
  const [starting, setStarting] = useState(false)
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api<Judges>("/admin/judges"),
    // Every 5 seconds while a machine is on its way somewhere; otherwise every half minute.
    refetchInterval: (query) =>
      query.state.data?.machines.some((m) => CHANGING.has(m.stage))
        ? 5_000
        : 30_000,
  })
  const stop = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/judges/${id}/stop`, { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: KEY }),
  })
  if (!data) return <Loading error={error} />

  const live = data.machines.filter((m) => LIVE.has(m.stage))
  return (
    <>
      <PageTitle
        action={
          can("platform.judges.start") && (
            <Button
              size="sm"
              disabled={
                !data.available || live.length >= data.settings.maxRunning
              }
              title={
                !data.available
                  ? "This copy of GretLab has no AWS role, so it can't start machines."
                  : live.length >= data.settings.maxRunning
                    ? "At the limit of judges at once: stop one or raise the limit."
                    : undefined
              }
              onClick={() => setStarting(true)}
            >
              Start a judge
            </Button>
          )
        }
      >
        Judges
      </PageTitle>
      <p className="mb-4 max-w-prose text-body-sm text-body">
        The machines that run students&apos; code. A judge for an organization
        runs only that organization&apos;s work while it&apos;s on, and helps
        everyone else when it&apos;s idle. Each machine costs money while it
        runs.
      </p>
      {!data.available && (
        <p role="status" className="mb-4 text-body-sm text-destructive">
          This copy of GretLab can&apos;t start machines: it has no AWS role
          (JUDGES_AWS_ROLE_ARN).
        </p>
      )}
      <Stats
        items={[
          {
            label: "Machines running",
            value: `${live.length} of ${data.settings.maxRunning}`,
          },
          { label: "Judges online", value: data.online.length },
          {
            label: "Free slots",
            value: data.online.reduce(
              (n, r) => n + Math.max(0, r.slots - r.busy),
              0
            ),
          },
        ]}
      />
      <FormMessage
        message={stop.error ? { text: stop.error.message, kind: "err" } : null}
      />
      <Card>
        <Table headers={["Machine", "Stage", "Size", "Started", ""]}>
          {data.machines.map((m) => (
            <tr key={m.id} data-testid="judge-machine">
              <td>
                <div className="text-ink">
                  {m.pool ? m.pool.name : "Everyone (shared)"}
                </div>
                <div className="text-xs text-body">
                  {m.instanceId ?? "not started yet"}
                </div>
              </td>
              <td>
                <Badge variant={STAGES[m.stage].tone}>
                  {STAGES[m.stage].label}
                </Badge>
                {m.note && (
                  <div className="mt-1 max-w-xs text-xs whitespace-normal text-body">
                    {m.note}
                  </div>
                )}
              </td>
              <td className="text-body-sm">{m.size}</td>
              <td className="text-body-sm">
                {formatDateTime(m.createdAt)}
                {m.requestedBy && (
                  <div className="text-xs text-body">by {m.requestedBy}</div>
                )}
              </td>
              <td className="text-right">
                {can("platform.judges.stop") &&
                  [
                    "requested",
                    "launching",
                    "installing",
                    "ready",
                    "failed",
                  ].includes(m.stage) && (
                    <ConfirmButton
                      size="sm"
                      variant="outline"
                      title="Stop this judge?"
                      description={
                        m.stage === "ready"
                          ? "It finishes the work it has, takes no more, then the machine ends. Its organization's work goes to the shared judges meanwhile."
                          : "The machine ends now."
                      }
                      confirmLabel="Stop judge"
                      onConfirm={() => stop.mutate(m.id)}
                    >
                      Stop
                    </ConfirmButton>
                  )}
              </td>
            </tr>
          ))}
        </Table>
        {data.machines.length === 0 && (
          <p className="mt-3 text-body-sm text-body">
            No machines started from here yet. Judges set up by hand still work
            and show below.
          </p>
        )}
      </Card>
      <h2 className="mt-6 mb-2 text-title-sm text-ink">Judges reporting in</h2>
      <Card>
        <Table headers={["Judge", "Serves", "Busy"]}>
          {data.online.map((r) => (
            <tr key={r.host} data-testid="judge-online">
              <td className="text-body-sm">{r.host}</td>
              <td className="text-body-sm">{r.pool ?? "Everyone (shared)"}</td>
              <td className="text-body-sm tabular-nums">
                {r.busy} of {r.slots}
              </td>
            </tr>
          ))}
        </Table>
        {data.online.length === 0 && (
          <p className="mt-3 text-body-sm text-destructive">
            No judge is online: code waits in the queue.
          </p>
        )}
      </Card>
      {can("platform.judges.settings") && <JudgeSettings data={data} />}
      {starting && (
        <StartDialog data={data} onClose={() => setStarting(false)} />
      )}
    </>
  )
}

function StartDialog({ data, onClose }: { data: Judges; onClose: () => void }) {
  const client = useQueryClient()
  const [pool, setPool] = useState("")
  const start = useMutation({
    mutationFn: () =>
      api<Machine>("/admin/judges", {
        method: "POST",
        body: pool.trim() ? { pool: pool.trim() } : {},
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: KEY })
      onClose()
    },
    meta: { quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a judge</DialogTitle>
          <DialogDescription>
            A {data.settings.size} machine. It takes a few minutes to set itself
            up; this page shows how it&apos;s going.
          </DialogDescription>
        </DialogHeader>
        <form
          id="start-judge"
          onSubmit={(e) => {
            e.preventDefault()
            start.mutate()
          }}
        >
          <Field
            label="For an organization (its address), or empty for everyone"
            help="The address is the greenwood in /orgs/greenwood."
          >
            <TextInput
              value={pool}
              placeholder="Everyone (shared)"
              onChange={(e) => setPool(e.target.value)}
            />
          </Field>
        </form>
        <FormMessage
          message={
            start.error ? { text: start.error.message, kind: "err" } : null
          }
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="start-judge" disabled={start.isPending}>
            Start judge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function JudgeSettings({ data }: { data: Judges }) {
  const client = useQueryClient()
  const [maxRunning, setMaxRunning] = useState(String(data.settings.maxRunning))
  const [size, setSize] = useState<string>(data.settings.size)
  const save = useMutation({
    mutationFn: () =>
      api("/admin/judges/settings", {
        method: "PUT",
        body: { maxRunning: Number(maxRunning), size },
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: KEY }),
    meta: { success: "Judge settings saved", quiet: true },
  })
  return (
    <>
      <h2 className="mt-6 mb-2 text-title-sm text-ink">Judge settings</h2>
      <Card>
        <form
          className="grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Judges at once">
            <TextInput
              type="number"
              min={0}
              max={50}
              value={maxRunning}
              onChange={(e) => setMaxRunning(e.target.value)}
            />
          </Field>
          <Field label="Machine size for new judges">
            <SelectInput value={size} onChange={(e) => setSize(e.target.value)}>
              {data.sizes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
        <FormMessage
          message={
            save.error ? { text: save.error.message, kind: "err" } : null
          }
        />
      </Card>
    </>
  )
}
