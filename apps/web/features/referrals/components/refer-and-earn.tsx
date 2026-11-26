"use client"

import { CopyIcon, LinkIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { Row, Section } from "@/components/settings-sections"
import { Loading, Stats, Table } from "@/features/admin/components/shell"
import { rupees } from "@/features/billing/components/plan-builder"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

import type { myReferrals } from "@/features/referrals/server"

type Mine = ApiResult<typeof myReferrals>

export const STAGE_LABEL: Record<string, string> = {
  waiting: "Waiting for approval",
  paused: "Paused",
  active: "Not paying yet",
  paying: "Paying",
}

const EARNING_STATUS: Record<
  string,
  { label: string; tone: "secondary" | "outline" }
> = {
  owed: { label: "Owed", tone: "outline" },
  paid: { label: "Paid", tone: "secondary" },
  void: { label: "Cancelled", tone: "outline" },
}

/**
 * Account › Refer and earn: your link, the organizations it brought, and what you've earned
 * (paid out by GretLab by hand). The share and window come from the platform's settings.
 */
export function ReferAndEarn() {
  const { data, error } = useQuery({
    queryKey: ["me", "referrals"],
    queryFn: () => api<Mine>("/me/referrals"),
  })
  const [copied, setCopied] = useState(false)
  if (!data) return <Loading error={error} />
  const link =
    typeof window === "undefined"
      ? data.path
      : `${window.location.origin}${data.path}`
  return (
    <div className="grid gap-6" data-testid="refer-and-earn">
      <Section
        title="Your link"
        description={
          data.enabled
            ? `Share it with a school, college or other organization. When one registers through it and pays for a plan, you earn ${data.percent}% of each payment (before GST) for its first ${data.months} months.`
            : "Referrals are switched off for now. What you've earned stays owed."
        }
      >
        <Row
          icon={<LinkIcon aria-hidden />}
          title={`Code ${data.code}`}
          detail={
            <span className="grid gap-1">
              <code
                className="font-mono text-caption break-all text-ink"
                data-testid="referral-link"
              >
                {link}
              </code>
              <span>Organizations can also type the code when they pay.</span>
            </span>
          }
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(link)
                  .then(() => setCopied(true))
              }
            >
              <CopyIcon aria-hidden /> {copied ? "Copied" : "Copy link"}
            </Button>
          }
        />
      </Section>

      <Stats
        items={[
          { label: "Organizations referred", value: data.referrals.length },
          {
            label: "Paying",
            value: data.referrals.filter((r) => r.stage === "paying").length,
          },
          { label: "Owed to you", value: rupees(data.owed) },
          {
            label: "Paid to you",
            value: rupees(data.paid),
            tone: data.paid ? "good" : undefined,
          },
        ]}
      />

      <section className="grid gap-2">
        <h2 className="text-title-sm text-ink">Organizations you referred</h2>
        {data.referrals.length === 0 ? (
          <p className="text-body-sm text-body">
            None yet. Organizations registered through your link appear here.
          </p>
        ) : (
          <Table headers={["Organization", "Where it is", "Since"]}>
            {data.referrals.map((r) => (
              <tr key={`${r.name}-${r.since}`}>
                <td className="text-ink">{r.name}</td>
                <td className="text-body">{STAGE_LABEL[r.stage]}</td>
                <td className="text-body tabular-nums">
                  {formatDate(r.since)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-title-sm text-ink">Earnings</h2>
        {data.earnings.length === 0 ? (
          <p className="text-body-sm text-body">
            Nothing yet: you earn when an organization you referred pays.
          </p>
        ) : (
          <Table headers={["Date", "From", "Share", "Amount", "Status"]}>
            {data.earnings.map((e) => (
              <tr key={e.id}>
                <td className="text-body tabular-nums">
                  {formatDate(e.createdAt)}
                </td>
                <td className="text-ink">{e.org}</td>
                <td className="text-body tabular-nums">{e.percent}%</td>
                <td className="text-right text-ink tabular-nums">
                  {rupees(e.amount)}
                </td>
                <td>
                  <Badge variant={EARNING_STATUS[e.status]?.tone ?? "outline"}>
                    {EARNING_STATUS[e.status]?.label ?? e.status}
                  </Badge>
                  {e.paidAt && (
                    <span className="ml-2 text-caption text-muted-foreground">
                      {formatDate(e.paidAt)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-caption text-body">
          GretLab pays what&apos;s owed by hand and marks it paid here.
        </p>
      </section>
    </div>
  )
}
