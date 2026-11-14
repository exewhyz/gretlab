"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { Loading, PageTitle, Stats } from "@/features/admin/components/shell"

import { api } from "@/lib/api/client"
import { Catalog, RulesDialog } from "./library-catalog"
import { Loans } from "./library-loans"
import { Setup, bookCount } from "./library-parts"
export { MemberLibrary } from "./member-library"

/** Manage › Library: the lending desk and the catalog. */
export function ManageLibrary({ slug }: { slug: string }) {
  const client = useQueryClient()
  const setup = useQuery({
    queryKey: ["org", slug, "books-setup"],
    queryFn: () => api<Setup>(`/orgs/${slug}/books/setup`),
  })
  const [rules, setRules] = useState(false)
  if (!setup.data) return <Loading error={setup.error} />
  const data = setup.data
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["org", slug, "books-setup"] }),
      client.invalidateQueries({ queryKey: ["org", slug, "books"] }),
      client.invalidateQueries({ queryKey: ["org", slug, "loans"] }),
    ])
  return (
    <>
      <PageTitle
        action={
          data.can.catalog && (
            <Button variant="outline" onClick={() => setRules(true)}>
              Loan rules
            </Button>
          )
        }
      >
        Library
      </PageTitle>
      <div data-testid="library-counts">
        <Stats
          items={[
            { label: "Titles", value: data.counts.titles },
            { label: "Copies", value: data.counts.copies },
            {
              label: "On loan",
              value: data.counts.out,
              hint: data.counts.copies
                ? `${Math.round((100 * data.counts.out) / data.counts.copies)}% of copies`
                : undefined,
            },
            {
              label: "Overdue",
              value: data.counts.overdue,
              tone: data.counts.overdue > 0 ? "bad" : undefined,
            },
          ]}
        />
      </div>
      <p className="mb-4 text-body-sm text-body">
        Loans last {data.settings.loanDays} days; each person may hold{" "}
        {bookCount(data.settings.maxLoans)}.
      </p>
      <Tabs defaultValue={data.can.lend ? "loans" : "catalog"}>
        <TabsList variant="line">
          {data.can.lend && <TabsTrigger value="loans">Loans</TabsTrigger>}
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
        </TabsList>
        {data.can.lend && (
          <TabsContent value="loans" className="pt-3">
            <Loans slug={slug} setup={data} onChange={refresh} />
          </TabsContent>
        )}
        <TabsContent value="catalog" className="pt-3">
          <Catalog slug={slug} canEdit={data.can.catalog} onChange={refresh} />
        </TabsContent>
      </Tabs>
      {rules && (
        <RulesDialog
          slug={slug}
          settings={data.settings}
          onDone={() => (setRules(false), void refresh())}
        />
      )}
    </>
  )
}
