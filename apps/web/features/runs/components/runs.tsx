"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { KindTerms, RunState } from "@workspace/judge"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import { Field, FormMessage, SelectInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { runLabel, runPercent, runStatus } from "@/features/runs/format"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { runProgress } from "@/features/runs/server"
import type { listRuns } from "@/features/runs/server"
import type { issueCertificates } from "@/features/certificates/server"

/*
 * Progress: a program's runs (cohorts, batches with dates) and, for one, each learner's
 * work, attendance, last activity and early warning, by pod with its mentor. Program
 * managers graduate learners from here, which issues their certificates.
 */

type Runs = ApiResult<typeof listRuns>

type Progress = ApiResult<typeof runProgress>

function RunBar({ state }: { state: RunState }) {
  const pct = runPercent(state)
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function RunsList({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "runs"],
    queryFn: () => api<Runs>(`/orgs/${slug}/runs`),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle>Progress</PageTitle>
      <p className="-mt-2 mb-4 max-w-3xl text-body-sm text-body">
        Each {data.terms.group.toLowerCase()} with dates and where it is, with
        who leads its groups. Open one for each{" "}
        {data.terms.learner.toLowerCase()}&apos;s progress.
      </p>
      {data.runs.length === 0 ? (
        <Card>
          <p data-testid="no-runs">
            No {data.terms.groups.toLowerCase()} with dates yet.
            {data.canEdit && (
              <>
                {" "}
                Give one its dates under{" "}
                <Link
                  className="text-primary underline"
                  href={orgPages(slug).manage(`/groups`)}
                >
                  {data.terms.groups}
                </Link>
                .
              </>
            )}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2" data-testid="runs">
          {data.runs.map((r) => (
            <Card key={r.id} className="grid gap-3" data-testid="run-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={orgPages(slug).manage(`/progress/${r.id}`)}
                    className="text-title-sm font-semibold text-ink hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-caption">
                    {runLabel(r.startsOn, r.endsOn)}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    r.state.status === "running"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-ink"
                  )}
                  data-testid="run-status"
                >
                  {runStatus(r.state)}
                </span>
              </div>
              <RunBar state={r.state} />
              <div className="text-caption">
                {r.people}{" "}
                {r.people === 1
                  ? data.terms.learner.toLowerCase()
                  : data.terms.learners.toLowerCase()}
                {r.lead && ` · ${data.terms.groupLead}: ${r.lead}`}
              </div>
              {r.pods.length > 0 && (
                <ul className="grid gap-1 text-body-sm">
                  {r.pods.map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between gap-2"
                      data-testid="run-pod"
                    >
                      <span className="text-ink">
                        {p.name}
                        {p.mine && (
                          <span className="ml-1.5 text-xs text-primary">
                            yours
                          </span>
                        )}
                      </span>
                      <span className="text-caption">
                        {p.people} ·{" "}
                        {p.lead ?? `no ${data.terms.groupLead.toLowerCase()}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={orgPages(slug).manage(`/progress/${r.id}`)}
                className="text-body-sm font-medium text-primary hover:underline"
              >
                See progress
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

const ago = (iso: string | null) => {
  if (!iso) return "Never"
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`
}

export function RunProgress({ slug, runId }: { slug: string; runId: string }) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "runs", runId],
    queryFn: () => api<Progress>(`/orgs/${slug}/runs/${runId}`),
  })
  const [pod, setPod] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [done, setDone] = useState<string | null>(null)
  const graduate = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof issueCertificates>>(
        `/orgs/${slug}/classes/${runId}/certificates`,
        {
          body: { kind: "graduation", userIds: [...picked] },
        }
      ),
    onSuccess: (r) => {
      setDone(
        r.issued
          ? `${r.issued} graduated, each with a certificate they can share.`
          : "They had all graduated already."
      )
      setPicked(new Set())
      void client.invalidateQueries({ queryKey: ["org", slug, "runs"] })
    },
  })
  if (!data) return <Loading error={error} />
  const t = data.terms
  const rows = data.learners.filter((l) => !pod || l.pod === pod)
  const podName = (id: string | null) =>
    data.pods.find((p) => p.id === id)?.name ?? "—"
  const risk = rows.filter((l) => !l.graduated && l.level === "risk").length
  const watch = rows.filter((l) => !l.graduated && l.level === "watch").length
  const graduated = rows.filter((l) => l.graduated).length
  const choosable = rows.filter((l) => !l.graduated)
  return (
    <div data-testid="run-progress">
      <PageTitle>{data.run.name}</PageTitle>
      <div className="-mt-2 mb-4 grid max-w-xl gap-2">
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-body">
          <span>{runLabel(data.run.startsOn, data.run.endsOn)}</span>
          <span className="font-semibold text-ink" data-testid="run-week">
            {runStatus(data.run.state)}
          </span>
          {data.run.lead && (
            <span>
              · {t.groupLead}: {data.run.lead}
            </span>
          )}
        </div>
        <RunBar state={data.run.state} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [t.learners, rows.length, "learners"],
            ["At risk", risk, "risk"],
            ["To watch", watch, "watch"],
            ["Graduated", graduated, "graduated"],
          ] as const
        ).map(([label, n, id]) => (
          <Card
            key={id}
            className="grid gap-0.5 p-4"
            data-testid={`tile-${id}`}
          >
            <div className="text-caption">{label}</div>
            <div className="text-title-md font-semibold text-ink">{n}</div>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        {data.pods.length > 1 ? (
          <Field label={data.run.podLevel}>
            <SelectInput value={pod} onChange={(e) => setPod(e.target.value)}>
              <option value="">
                {data.whole ? `All of ${data.run.name}` : "All of yours"}
              </option>
              {data.pods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.lead ? ` (${p.lead})` : ""}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : (
          <span />
        )}
        {data.canGraduate && data.run.state.status !== "upcoming" && (
          <Button
            disabled={picked.size === 0 || graduate.isPending}
            onClick={() => graduate.mutate()}
          >
            Graduate{picked.size > 0 && ` ${picked.size}`}
          </Button>
        )}
      </div>
      {done && <FormMessage message={{ text: done, kind: "ok" }} />}
      {graduate.error && (
        <FormMessage message={{ text: graduate.error.message, kind: "err" }} />
      )}
      {rows.length === 0 ? (
        <Card>No {t.learners.toLowerCase()} here yet.</Card>
      ) : (
        <Table
          headers={[
            data.canGraduate ? "" : " ",
            t.learner,
            data.run.podLevel,
            "Work handed in",
            "Attendance",
            "Last active",
            "Status",
          ]}
        >
          {rows.map((l) => (
            <tr key={l.id} data-testid="progress-row">
              <td className="w-8">
                {data.canGraduate && !l.graduated && (
                  <Checkbox
                    aria-label={`Choose ${l.name}`}
                    checked={picked.has(l.id)}
                    onCheckedChange={(on) =>
                      setPicked((all) => {
                        const next = new Set(all)
                        if (on) next.add(l.id)
                        else next.delete(l.id)
                        return next
                      })
                    }
                  />
                )}
              </td>
              <td>
                <div className="font-medium">{l.name}</div>
                <div className="text-caption">{l.email}</div>
              </td>
              <td className="whitespace-nowrap">{podName(l.pod)}</td>
              <td className="whitespace-nowrap" data-testid="work-done">
                {l.due ? `${l.done} of ${l.due}` : "Nothing due yet"}
              </td>
              <td className="whitespace-nowrap">
                {l.attendance && l.attendance.total
                  ? `${Math.round((100 * l.attendance.present) / l.attendance.total)}%`
                  : "—"}
              </td>
              <td className="whitespace-nowrap">{ago(l.lastActive)}</td>
              <td className="min-w-48 whitespace-normal">
                {l.graduated ? (
                  <Link
                    href={`/certificates/${l.graduated}`}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    data-testid="graduated"
                  >
                    Graduated
                  </Link>
                ) : l.level ? (
                  <>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        l.level === "risk"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-ink"
                      )}
                      data-testid="level"
                    >
                      {l.level === "risk" ? "At risk" : "Watch"}
                    </span>
                    <div className="mt-1 text-caption">
                      {l.reasons.join(" · ")}
                    </div>
                  </>
                ) : (
                  <span className="text-caption">On track</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {data.canGraduate && choosable.length > 0 && picked.size === 0 && (
        <div className="mt-2 flex gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setPicked(new Set(choosable.map((l) => l.id)))}
          >
            Choose everyone not yet graduated
          </Button>
        </div>
      )}
    </div>
  )
}
