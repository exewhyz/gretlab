"use client"

import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

export interface CampusLoan {
  id: string
  title: string
  author: string
  dueOn: string
  status: "out" | "overdue" | "returned" | "lost"
}

export interface CampusData {
  library: { loans: CampusLoan[] } | null
}

/** Library books (and later bus and hostel) for one person in one organization. */
export function CampusSummary({
  data,
  slug,
  own,
}: {
  data: CampusData
  slug: string
  /** Their own (links to the library page); a parent sees it without links. */
  own: boolean
}) {
  if (!data.library) return null
  const loans = data.library.loans
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="campus">
      <div className="rounded-lg border border-hairline bg-card p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="text-title-sm text-ink">Library</h3>
          {own && (
            <Link
              href={`/orgs/${slug}/books`}
              className="text-caption text-body hover:text-ink"
            >
              Browse
            </Link>
          )}
        </div>
        {loans.length === 0 ? (
          <p className="text-body-sm text-body">No books out.</p>
        ) : (
          <ul className="grid gap-1 text-body-sm" aria-label="Books out">
            {loans.map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-ink">{l.title}</span>
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    l.status === "overdue" ? "text-destructive" : "text-body"
                  )}
                >
                  {l.status === "overdue"
                    ? `Overdue since ${l.dueOn}`
                    : `Due ${l.dueOn}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
