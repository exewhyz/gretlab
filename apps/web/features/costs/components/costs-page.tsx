"use client"

import { useQuery } from "@tanstack/react-query"

import {
  Card,
  Loading,
  PageTitle,
  Stats,
  Table,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { costs } from "@/features/costs/server"

type Costs = ApiResult<typeof costs>

const usd = (n: number) => `US$${n.toFixed(n < 10 ? 2 : 0)}`

export function CostsPage() {
  const { data, error } = useQuery({
    queryKey: ["admin", "costs"],
    queryFn: () => api<Costs>("/admin/costs"),
    refetchInterval: 60_000,
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle>Costs</PageTitle>
      <p className="mb-4 max-w-prose text-body-sm text-body">
        What judge machines started from the dashboard cost in {data.month}, at
        AWS&apos;s on-demand prices in Sydney: each machine&apos;s size, plus
        its public address and disk. Judges set up by hand, data transfer and
        anything else on the AWS bill aren&apos;t counted; the AWS budget alarm
        watches the whole bill.
      </p>
      <Stats
        items={[
          { label: "So far this month", value: usd(data.soFar) },
          {
            label: "Forecast for the month",
            value: usd(data.forecast),
            hint: "if what runs now keeps running",
          },
          {
            label: "Running now",
            value: `${data.running} machine${data.running === 1 ? "" : "s"}`,
            hint: `${usd(data.runningHourly)} an hour`,
          },
        ]}
      />
      <h2 className="mt-6 mb-2 text-title-sm text-ink">By pool</h2>
      <Card>
        <Table headers={["Pool", "Machine hours", "Cost"]}>
          {data.byPool.map((p) => (
            <tr key={p.pool ?? "shared"} data-testid="cost-pool">
              <td className="text-body-sm">{p.name ?? "Everyone (shared)"}</td>
              <td className="text-body-sm tabular-nums">
                {p.hours.toFixed(1)}
              </td>
              <td className="text-body-sm tabular-nums">{usd(p.cost)}</td>
            </tr>
          ))}
        </Table>
        {data.byPool.length === 0 && (
          <p className="mt-3 text-body-sm text-body">
            No machines started from the dashboard this month.
          </p>
        )}
      </Card>
      <h2 className="mt-6 mb-2 text-title-sm text-ink">Prices used</h2>
      <Card>
        <Table headers={["Size", "An hour"]}>
          {Object.entries(data.prices).map(([size, price]) => (
            <tr key={size}>
              <td className="text-body-sm">{size}</td>
              <td className="text-body-sm tabular-nums">
                US${price.toFixed(4)}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}
