"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ConfirmDialog } from "@/components/confirm"
import { Field, FormMessage, SelectInput } from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { promotionPlan } from "@/features/records/server"
import type { listYears, promote } from "@/features/records/server"

export type Plan = ApiResult<typeof promotionPlan>

export type Counts = {
  moved: number
  repeated: number
  graduated: number
  withdrawn: number
  skipped: number
}

/** Manage › Academic years › Promote: move a year's students on to the next. */
export function Promotion({ slug }: { slug: string }) {
  const client = useQueryClient()
  const years = useQuery({
    queryKey: ["org", slug, "academic-years"],
    queryFn: () =>
      api<ApiResult<typeof listYears>>(`/orgs/${slug}/academic-years`),
  })
  const list = years.data?.years ?? []
  const current = list.find((y) => y.isCurrent) ?? list[0]
  const [fromId, setFromId] = useState("")
  const [toId, setToId] = useState("")
  const from = fromId || current?.id || ""
  const later = list
    .filter((y) => y.id !== from)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  const to =
    toId ||
    later.find(
      (y) => y.startsOn > (list.find((x) => x.id === from)?.startsOn ?? "")
    )?.id ||
    later[0]?.id ||
    ""
  const plan = useQuery({
    queryKey: ["org", slug, "promotion", from, to],
    queryFn: () =>
      api<Plan>(`/orgs/${slug}/academic-years/promotion?from=${from}&to=${to}`),
    enabled: Boolean(from && to && from !== to),
  })
  const [sections, setSections] = useState<Record<string, string>>({})
  const [exceptions, setExceptions] = useState<Record<string, string>>({})
  const [makeCurrent, setMakeCurrent] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const body = (apply: boolean) => ({
    fromYearId: from,
    toYearId: to,
    sections: Object.fromEntries(
      (plan.data?.sections ?? []).map((s) => [
        s.groupId,
        sections[s.groupId] ?? s.suggested,
      ])
    ),
    exceptions,
    makeCurrent,
    apply,
  })
  const preview = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof promote>>(`/orgs/${slug}/academic-years/promotion`, {
        body: body(false),
      }),
  })
  const apply = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof promote>>(`/orgs/${slug}/academic-years/promotion`, {
        body: body(true),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["org", slug] }),
  })
  if (!years.data) return <Loading error={years.error} />
  if (list.length < 2) {
    return (
      <>
        <PageTitle>Promote students</PageTitle>
        <p className="text-body-sm text-muted-foreground">
          Add next year under Academic years first.
        </p>
      </>
    )
  }
  const options = (keepSame: string) => (
    <>
      <option value="repeat">{keepSame}</option>
      <option value="graduate">Graduate</option>
      <option value="withdraw">Leaves the school</option>
      {(plan.data?.targets ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.path}
        </option>
      ))}
    </>
  )
  const describe = (c: Counts) =>
    `${c.moved} move up, ${c.repeated} stay in their class, ${c.graduated} graduate, ${c.withdrawn} leave${c.skipped ? `; ${c.skipped} already have a class in ${plan.data?.to.name}` : ""}.`
  return (
    <div className="grid gap-5" data-testid="promotion">
      <Link
        href={orgPages(slug).manage(`/academic-years`)}
        className="text-body-sm text-muted-foreground hover:text-ink"
      >
        ‹ Academic years
      </Link>
      <PageTitle>Promote students</PageTitle>
      <p className="-mt-3 max-w-2xl text-body-sm text-muted-foreground">
        Each class moves on together; change a class&apos;s destination, or one
        student&apos;s. Nobody moves until the new year is current, unless you
        make it current here. Running it again skips anyone already placed.
      </p>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label="From">
          <SelectInput
            value={from}
            onChange={(e) => (
              setFromId(e.target.value),
              setSections({}),
              setExceptions({}),
              preview.reset()
            )}
          >
            {list.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="To">
          <SelectInput
            value={to}
            onChange={(e) => (setToId(e.target.value), preview.reset())}
          >
            {list
              .filter((y) => y.id !== from)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? " (current)" : ""}
                </option>
              ))}
          </SelectInput>
        </Field>
      </div>
      {!plan.data ? (
        <Loading error={plan.error} />
      ) : plan.data.sections.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>
              No one is in a class in {plan.data.from.name}
            </EmptyTitle>
            <EmptyDescription>
              Place students in classes for that year first.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="promotion-sections">
            <TableHeader>
              <TableRow>
                <TableHead>Class in {plan.data.from.name}</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead>Goes to in {plan.data.to.name}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.data.sections.map((s) => (
                <TableRow
                  key={s.groupId}
                  data-testid="promotion-row"
                  className="align-top"
                >
                  <TableCell className="font-medium">
                    {s.path}
                    <details className="mt-1 font-normal">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        One student differently
                      </summary>
                      <ul className="mt-2 grid gap-1.5">
                        {s.students.map((st) => (
                          <li
                            key={st.id}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,12rem)] items-center gap-2 text-body-sm"
                          >
                            <span className="truncate">
                              {st.name}
                              {st.already && (
                                <span className="text-xs text-muted-foreground">
                                  {" "}
                                  · already placed
                                </span>
                              )}
                            </span>
                            <SelectInput
                              aria-label={`${st.name} goes to`}
                              value={exceptions[st.id] ?? ""}
                              onChange={(e) => {
                                const next = { ...exceptions }
                                if (e.target.value) next[st.id] = e.target.value
                                else delete next[st.id]
                                setExceptions(next)
                                preview.reset()
                              }}
                            >
                              <option value="">With the class</option>
                              {options("Stays in this class")}
                            </SelectInput>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.students.length}
                  </TableCell>
                  <TableCell>
                    <SelectInput
                      aria-label={`${s.path} goes to`}
                      value={sections[s.groupId] ?? s.suggested}
                      onChange={(e) => (
                        setSections({
                          ...sections,
                          [s.groupId]: e.target.value,
                        }),
                        preview.reset()
                      )}
                    >
                      {options("Stays in the same class")}
                    </SelectInput>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {plan.data && plan.data.sections.length > 0 && (
        <div className="grid gap-3">
          {!plan.data.to.isCurrent && (
            <label className="flex items-center gap-2 text-body-sm">
              <Checkbox
                checked={makeCurrent}
                onCheckedChange={(on) => setMakeCurrent(on)}
              />
              Make {plan.data.to.name} the current year afterwards (everyone
              moves to their new class now)
            </label>
          )}
          {preview.data && (
            <Alert data-testid="promotion-preview">
              <AlertTitle>What will happen</AlertTitle>
              <AlertDescription>
                {describe(preview.data.counts)}
              </AlertDescription>
            </Alert>
          )}
          {apply.data && (
            <Alert data-testid="promotion-done">
              <AlertTitle>Done</AlertTitle>
              <AlertDescription>{describe(apply.data.counts)}</AlertDescription>
            </Alert>
          )}
          {(preview.error ?? apply.error) && (
            <FormMessage
              message={{
                text: (preview.error ?? apply.error)!.message,
                kind: "err",
              }}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={preview.isPending}
              onClick={() => preview.mutate()}
            >
              Preview
            </Button>
            <Button
              disabled={!preview.data || apply.isPending || Boolean(apply.data)}
              onClick={() => setConfirming(true)}
            >
              Promote
            </Button>
          </div>
        </div>
      )}
      {confirming && preview.data && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(false)}
          title={`Promote ${plan.data?.from.name} to ${plan.data?.to.name}?`}
          description={describe(preview.data.counts)}
          confirmLabel="Promote"
          tone="default"
          onConfirm={() => apply.mutate()}
        />
      )}
    </div>
  )
}
