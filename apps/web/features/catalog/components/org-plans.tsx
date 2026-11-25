"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import type { orgStudyPlan, orgStudyPlans } from "@/features/catalog/org-plans"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

/** An organization's published study plans, for its members (features/catalog/org-plans.ts). */
export function OrgPlans({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "study-plans"],
    queryFn: () =>
      api<ApiResult<typeof orgStudyPlans>>(`/orgs/${slug}/study-plans`),
  })
  if (!data) return <Loading error={error} />
  const shown = data.plans.filter((p) => p.published)
  return (
    <div className="grid gap-4" data-testid="org-plans">
      <PageTitle>Study plans</PageTitle>
      {shown.length === 0 ? (
        <p className="text-body-sm text-body">No study plans here yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((plan) => (
            <Link
              key={plan.slug}
              href={`/orgs/${slug}/study-plans/${plan.slug}`}
              className="rounded-lg border border-hairline bg-card p-4 hover:border-primary/40"
              data-testid="org-plan"
            >
              <div className="text-title-sm text-ink">{plan.title}</div>
              {plan.description && (
                <p className="mt-1 line-clamp-2 text-body-sm text-body">
                  {plan.description}
                </p>
              )}
              <div className="mt-2 text-caption text-body">
                {plan.size} {plan.size === 1 ? "problem" : "problems"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** One plan: its problems in order, each linked to where it's solved, and the viewer's progress. */
export function OrgPlan({ slug, plan }: { slug: string; plan: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "study-plan", plan],
    queryFn: () =>
      api<ApiResult<typeof orgStudyPlan>>(`/orgs/${slug}/study-plans/${plan}`),
  })
  if (!data) return <Loading error={error} />
  const solved = data.items.filter((i) => i.solved).length
  return (
    <div className="grid gap-4" data-testid="org-plan-page">
      <div>
        <Link
          href={`/orgs/${slug}/study-plans`}
          className="text-caption text-primary hover:underline"
        >
          Study plans
        </Link>
        <PageTitle>{data.title}</PageTitle>
        {data.description && (
          <p className="text-body-sm text-body">{data.description}</p>
        )}
        <p className="mt-1 text-caption text-body" data-testid="plan-progress">
          {solved} of {data.items.length} solved
          {!data.published && " · Draft: only people who manage plans see it"}
        </p>
      </div>
      <Card>
        {data.items.length === 0 ? (
          <p className="text-body-sm text-body">
            No problems in this plan yet.
          </p>
        ) : (
          <ol className="grid divide-y divide-hairline">
            {data.items.map((item, i) => (
              <li
                key={item.slug}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <Link
                  href={item.href}
                  className="text-body-sm text-ink hover:text-primary"
                >
                  {i + 1}. {item.title}
                </Link>
                <span className="flex items-center gap-2 text-caption text-body">
                  <span className="capitalize">{item.level}</span>
                  {item.solved && (
                    <span
                      className="flex items-center gap-1 text-success"
                      data-testid="solved"
                    >
                      <CheckCircleIcon aria-hidden weight="fill" />
                      Solved
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}
