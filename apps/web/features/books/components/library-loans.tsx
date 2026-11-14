"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { formatDay } from "@/lib/format"

import type { searchBorrowers } from "@/features/books/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { Book, Loan, STATUS, Setup, useBooks } from "./library-parts"

export function Loans({
  slug,
  setup,
  onChange,
}: {
  slug: string
  setup: Setup
  onChange: () => void
}) {
  const [show, setShow] = useState("out")
  const [q, setQ] = useState("")
  const [lending, setLending] = useState(false)
  const loans = useQuery({
    queryKey: ["org", slug, "loans", show, q.trim()],
    queryFn: () =>
      api<Loan[]>(
        `/orgs/${slug}/books/loans?${new URLSearchParams({ show, q: q.trim() })}`
      ),
  })
  const act = useMutation({
    mutationFn: (v: { id: string; action: "return" | "renew" | "lost" }) =>
      api(`/orgs/${slug}/books/loans/${v.id}`, { body: { action: v.action } }),
    onSuccess: onChange,
  })
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SelectInput
          aria-label="Show"
          value={show}
          onChange={(e) => setShow(e.target.value)}
          className="w-auto"
        >
          <option value="out">Out now</option>
          <option value="overdue">Overdue</option>
          <option value="all">All, recent first</option>
        </SelectInput>
        <TextInput
          aria-label="Search loans"
          placeholder="Book or borrower"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Button className="ml-auto" onClick={() => setLending(true)}>
          Lend a book
        </Button>
      </div>
      {act.error && (
        <FormMessage message={{ text: act.error.message, kind: "err" }} />
      )}
      {!loans.data ? (
        <Loading error={loans.error} />
      ) : loans.data.length === 0 ? (
        <p className="text-body-sm text-body">No loans here.</p>
      ) : (
        <ul
          className="divide-y divide-hairline rounded-lg border border-hairline bg-card"
          data-testid="loans"
        >
          {loans.data.map((l) => (
            <li
              key={l.id}
              data-testid="loan"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-body-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{l.title}</div>
                <div className="truncate text-xs text-body">
                  {l.name} · {l.email}
                </div>
              </div>
              <div className="text-xs">
                <span
                  className={cn(
                    l.status === "overdue" ? "text-destructive" : "text-body"
                  )}
                >
                  {STATUS[l.status]}
                </span>
                <span className="text-body">
                  {" "}
                  ·{" "}
                  {l.returnedOn
                    ? `back ${formatDay(l.returnedOn)}`
                    : `due ${formatDay(l.dueOn)}`}
                </span>
              </div>
              {(l.status === "out" || l.status === "overdue") && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: l.id, action: "return" })}
                  >
                    Return
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: l.id, action: "renew" })}
                  >
                    Renew
                  </Button>
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title={`Mark "${l.title}" lost?`}
                    description="The loan closes and the library has one copy fewer."
                    confirmLabel="Mark lost"
                    onConfirm={() => act.mutate({ id: l.id, action: "lost" })}
                  >
                    Lost
                  </ConfirmButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {lending && (
        <LendDialog
          slug={slug}
          setup={setup}
          onDone={(changed) => (setLending(false), changed && onChange())}
        />
      )}
    </div>
  )
}

export type Borrower = ApiResult<typeof searchBorrowers>[number]

export function LendDialog({
  slug,
  setup,
  onDone,
}: {
  slug: string
  setup: Setup
  onDone: (changed: boolean) => void
}) {
  const [who, setWho] = useState("")
  const [borrower, setBorrower] = useState<Borrower | null>(null)
  const [what, setWhat] = useState("")
  const [book, setBook] = useState<Book | null>(null)
  const [dueOn, setDueOn] = useState(() => {
    const d = new Date(`${setup.today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + setup.settings.loanDays)
    return d.toISOString().slice(0, 10)
  })
  const people = useQuery({
    queryKey: ["org", slug, "borrowers", who.trim()],
    queryFn: () =>
      api<Borrower[]>(
        `/orgs/${slug}/books/borrowers?q=${encodeURIComponent(who.trim())}`
      ),
    enabled: !borrower && who.trim().length >= 2,
  })
  const books = useBooks(slug, what)
  const lend = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/books/loans`, {
        body: { bookId: book!.id, userId: borrower!.id, dueOn },
      }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lend a book</DialogTitle>
          <DialogDescription>
            To a member of the organization.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {borrower ? (
            <Chosen
              title={borrower.name}
              detail={`${borrower.email} · holds ${borrower.holding} of ${setup.settings.maxLoans}`}
              onChange={() => setBorrower(null)}
            />
          ) : (
            <>
              <Field label="Borrower">
                <TextInput
                  placeholder="Search by name or email"
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                />
              </Field>
              {who.trim().length >= 2 && (
                <Picks
                  label="Members found"
                  items={(people.data ?? []).map((p) => ({
                    id: p.id,
                    title: p.name,
                    detail: `${p.email} · holds ${p.holding}`,
                  }))}
                  onPick={(id) =>
                    setBorrower(people.data!.find((p) => p.id === id)!)
                  }
                />
              )}
            </>
          )}
          {book ? (
            <Chosen
              title={book.title}
              detail={`${book.available} of ${book.copies} on the shelf`}
              onChange={() => setBook(null)}
            />
          ) : (
            <>
              <Field label="Book">
                <TextInput
                  placeholder="Title, author, ISBN or category"
                  value={what}
                  onChange={(e) => setWhat(e.target.value)}
                />
              </Field>
              {what.trim().length >= 2 && (
                <Picks
                  label="Books found"
                  items={(books.data ?? []).map((b) => ({
                    id: b.id,
                    title: b.title,
                    detail: `${b.author ? `${b.author} · ` : ""}${b.available} of ${b.copies} free`,
                    disabled: b.available === 0,
                  }))}
                  onPick={(id) =>
                    setBook(books.data!.find((b) => b.id === id)!)
                  }
                />
              )}
            </>
          )}
          <Field label="Due back">
            <TextInput
              type="date"
              min={setup.today}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </Field>
          {lend.error && (
            <FormMessage message={{ text: lend.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button
            disabled={!borrower || !book || lend.isPending}
            onClick={() => lend.mutate()}
          >
            Lend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Chosen({
  title,
  detail,
  onChange,
}: {
  title: string
  detail: string
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2 text-body-sm">
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{title}</div>
        <div className="truncate text-xs text-body">{detail}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  )
}

export function Picks({
  label,
  items,
  onPick,
}: {
  label: string
  items: { id: string; title: string; detail: string; disabled?: boolean }[]
  onPick: (id: string) => void
}) {
  return (
    <ul
      className="max-h-48 overflow-y-auto rounded-md border border-hairline"
      aria-label={label}
    >
      {items.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            disabled={i.disabled}
            className="w-full px-3 py-2 text-left text-body-sm hover:bg-muted disabled:opacity-50"
            onClick={() => onPick(i.id)}
          >
            <span className="font-medium text-ink">{i.title}</span>{" "}
            <span className="text-xs text-body">{i.detail}</span>
          </button>
        </li>
      ))}
      {items.length === 0 && (
        <li className="px-3 py-2 text-body-sm text-body">Nothing matches.</li>
      )}
    </ul>
  )
}
