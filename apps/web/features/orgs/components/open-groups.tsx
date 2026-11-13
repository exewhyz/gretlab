"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { KindTerms } from "@workspace/judge"

import { Button } from "@workspace/ui/components/button"

import { FormMessage } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

interface Data {
  terms: KindTerms
  groups: {
    id: string
    name: string
    description: string
    members: number
    lead: string | null
    mine: boolean
  }[]
}

/** A community's open groups: find one, join it, leave it. Yours first. */
export function OpenGroups({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "open-groups"]
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api<Data>(`/orgs/${slug}/open-groups`) })
  const toggle = useMutation({
    mutationFn: (g: { id: string; join: boolean }) =>
      api<Data>(`/orgs/${slug}/open-groups/${g.id}`, { method: g.join ? "POST" : "DELETE" }),
    onSuccess: (next) => {
      client.setQueryData(key, next)
      // Their home, sidebar and events follow what they're in.
      void client.invalidateQueries({ queryKey: ["org", slug, "home"] })
      void client.invalidateQueries({ queryKey: ["org", slug, "events"] })
    },
  })
  if (!data) return <Loading error={error} />
  const t = data.terms
  return (
    <>
      <PageTitle>{t.groups}</PageTitle>
      <p className="-mt-2 mb-4 max-w-2xl text-body-sm text-body">
        Join the {t.groups.toLowerCase()} you&apos;re interested in to see their events and
        notices. Leave any time.
      </p>
      {toggle.error && <FormMessage message={{ text: toggle.error.message, kind: "err" }} />}
      {data.groups.length === 0 ? (
        <Card>
          <p data-testid="no-open-groups">No {t.groups.toLowerCase()} are open to join yet.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.groups.map((g) => (
            <Card key={g.id} className="grid content-between gap-3" data-testid="open-group">
              <div className="grid gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-title-sm font-semibold text-ink">{g.name}</h2>
                  {g.mine && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-active">
                      Joined
                    </span>
                  )}
                </div>
                {g.description && <p className="text-body-sm">{g.description}</p>}
                <p className="text-caption">
                  {g.members} {g.members === 1 ? t.learner.toLowerCase() : t.learners.toLowerCase()}
                  {g.lead && ` · ${t.groupLead}: ${g.lead}`}
                </p>
              </div>
              <Button
                variant={g.mine ? "outline" : "default"}
                size="sm"
                disabled={toggle.isPending}
                aria-label={`${g.mine ? "Leave" : "Join"} ${g.name}`}
                onClick={() => toggle.mutate({ id: g.id, join: !g.mine })}
              >
                {g.mine ? "Leave" : "Join"}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
