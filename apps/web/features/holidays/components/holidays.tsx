"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { listHolidays } from "@/features/holidays/server"

type Holiday = ApiResult<typeof listHolidays>["holidays"][number]

/** "Mon, Nov 9" (UTC, so a day never shifts with the viewer's zone). */
const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
const length = (h: Holiday) =>
  (Date.parse(`${h.endsOn}T00:00:00Z`) - Date.parse(`${h.startsOn}T00:00:00Z`)) /
    86_400_000 +
  1

/** Manage › Holidays: the days the organization is closed, coming ones first. */
export function ManageHolidays({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "holidays"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<ApiResult<typeof listHolidays>>(`/orgs/${slug}/holidays`),
  })
  const [name, setName] = useState("")
  const [startsOn, setStartsOn] = useState("")
  const [endsOn, setEndsOn] = useState("")
  const add = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/holidays`, {
        body: { name, startsOn, endsOn: endsOn || startsOn },
      }),
    onSuccess: () => {
      setName("")
      setStartsOn("")
      setEndsOn("")
      void client.invalidateQueries({ queryKey: key })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/holidays/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />
  const today = new Date().toISOString().slice(0, 10)
  const coming = data.holidays.filter((h) => h.endsOn >= today)
  const past = data.holidays.filter((h) => h.endsOn < today).reverse()

  const rows = (list: Holiday[]) => (
    <Table headers={["Holiday", "From", "To", "Days", ""]}>
      {list.map((h) => (
        <tr key={h.id} data-testid="holiday-row">
          <td className="text-ink">{h.name}</td>
          <td>{day(h.startsOn)}</td>
          <td>{h.endsOn === h.startsOn ? "—" : day(h.endsOn)}</td>
          <td className="tabular-nums">{length(h)}</td>
          <td className="text-right">
            {data.canEdit && (
              <ConfirmButton
                size="xs"
                variant="ghost"
                title={`Remove ${h.name}?`}
                description="It comes off everyone's calendar, and registers are expected on those days again."
                confirmLabel="Remove"
                onConfirm={() => remove.mutate(h.id)}
              >
                Remove
              </ConfirmButton>
            )}
          </td>
        </tr>
      ))}
    </Table>
  )

  return (
    <>
      <PageTitle>Holidays</PageTitle>
      <p className="mb-4 max-w-2xl text-body-sm text-body">
        Days the organization is closed. They show on everyone&apos;s calendar,
        and no register is expected on them.
      </p>
      {data.canEdit && (
        <Card className="mb-5">
          <form
            className="grid gap-3 min-[801px]:grid-cols-[2fr_1fr_1fr_auto] min-[801px]:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate()
            }}
          >
            <Field label="Name">
              <TextInput
                value={name}
                placeholder="Diwali break"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="First day">
              <TextInput
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </Field>
            <Field label="Last day">
              <TextInput
                type="date"
                value={endsOn}
                min={startsOn || undefined}
                placeholder="Same day"
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!name.trim() || !startsOn || add.isPending}>
              Add holiday
            </Button>
          </form>
          {add.error && (
            <div className="mt-3">
              <FormMessage message={{ text: add.error.message, kind: "err" }} />
            </div>
          )}
        </Card>
      )}
      {data.holidays.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No holidays yet</EmptyTitle>
            <EmptyDescription>
              Add term breaks and public holidays so calendars and registers know
              when you&apos;re closed.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-6">
          {coming.length > 0 && (
            <section className="grid gap-2">
              <h2 className="text-title-sm text-ink">Coming up</h2>
              {rows(coming)}
            </section>
          )}
          {past.length > 0 && (
            <section className="grid gap-2">
              <h2 className="text-title-sm text-ink">Past</h2>
              {rows(past)}
            </section>
          )}
        </div>
      )}
    </>
  )
}
