"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { formatDay } from "@/lib/format"

import type { myLibrary } from "@/features/books/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"
import { BookList } from "./library-catalog"
import { bookCount, useBooks } from "./library-parts"

/** /orgs/:slug/books: my books out, and the catalog to browse. */
export function MemberLibrary({ slug }: { slug: string }) {
  const mine = useQuery({
    queryKey: ["org", slug, "books-mine"],
    queryFn: () => api<ApiResult<typeof myLibrary>>(`/orgs/${slug}/books/mine`),
  })
  const [q, setQ] = useState("")
  const books = useBooks(slug, q)
  if (!mine.data) return <Loading error={mine.error} />
  return (
    // One column that may shrink to the screen, so long titles wrap rather than widen it.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <header>
        <Link
          href={orgPages(slug).home}
          className="text-caption text-body hover:text-ink"
        >
          ‹ {mine.data.org.name}
        </Link>
        <h1 className="text-display-sm text-ink">Library</h1>
        <p className="text-body-sm text-body">
          Borrow at the library desk: up to{" "}
          {bookCount(mine.data.settings.maxLoans)}
          for {mine.data.settings.loanDays} days.
        </p>
      </header>
      <section aria-labelledby="mine">
        <h2 id="mine" className="mb-2 text-title-sm text-ink">
          My books
        </h2>
        {mine.data.loans.length === 0 ? (
          <p className="text-body-sm text-body">You have no books out.</p>
        ) : (
          <ul className="grid gap-1 text-body-sm" data-testid="my-loans">
            {mine.data.loans.map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="min-w-0 [overflow-wrap:anywhere] text-ink">
                  {l.title}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    l.status === "overdue" ? "text-destructive" : "text-body"
                  )}
                >
                  {l.status === "overdue"
                    ? `Overdue since ${formatDay(l.dueOn)}`
                    : `Due ${formatDay(l.dueOn)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="catalog" className="grid gap-2">
        <h2 id="catalog" className="text-title-sm text-ink">
          Catalog
        </h2>
        <TextInput
          aria-label="Search the catalog"
          placeholder="Title, author, ISBN or category"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <BookList books={books.data} error={books.error} />
      </section>
    </div>
  )
}
