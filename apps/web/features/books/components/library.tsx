"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle, Stats } from "@/features/admin/components/shell"
import { formatDay } from "@/lib/format"

import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type {
  librarySetup,
  listBooks,
  listLoans,
  searchBorrowers,
} from "@/features/books/server"
import type { importBooks, myLibrary } from "@/features/books/server"

type Book = ApiResult<typeof listBooks>[number]

type Loan = ApiResult<typeof listLoans>[number]

type Setup = ApiResult<typeof librarySetup>

const bookCount = (n: number) => `${n} book${n === 1 ? "" : "s"}`

const STATUS: Record<Loan["status"], string> = {
  out: "Out",
  overdue: "Overdue",
  returned: "Returned",
  lost: "Lost",
}

function useBooks(slug: string, q: string) {
  return useQuery({
    queryKey: ["org", slug, "books", q.trim()],
    queryFn: () =>
      api<Book[]>(`/orgs/${slug}/books?q=${encodeURIComponent(q.trim())}`),
  })
}

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

/* ---------- loans ---------- */

function Loans({
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
                  · {l.returnedOn ? `back ${formatDay(l.returnedOn)}` : `due ${formatDay(l.dueOn)}`}
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

type Borrower = ApiResult<typeof searchBorrowers>[number]

function LendDialog({
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

function Chosen({
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

function Picks({
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

/* ---------- catalog ---------- */

function Catalog({
  slug,
  canEdit,
  onChange,
}: {
  slug: string
  canEdit: boolean
  onChange: () => void
}) {
  const [q, setQ] = useState("")
  const books = useBooks(slug, q)
  const [editing, setEditing] = useState<Book | "new" | null>(null)
  const [importing, setImporting] = useState(false)
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/books/${id}`, { method: "DELETE" }),
    onSuccess: onChange,
  })
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextInput
          aria-label="Search the catalog"
          placeholder="Title, author, ISBN or category"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              Add from a list
            </Button>
            <Button onClick={() => setEditing("new")}>Add book</Button>
          </div>
        )}
      </div>
      {remove.error && (
        <FormMessage message={{ text: remove.error.message, kind: "err" }} />
      )}
      <BookList books={books.data} error={books.error}>
        {(b) =>
          canEdit && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                Edit
              </Button>
              <ConfirmButton
                size="sm"
                variant="ghost"
                title={`Remove "${b.title}"?`}
                description="It leaves the catalog, with its loan history."
                confirmLabel="Remove"
                onConfirm={() => remove.mutate(b.id)}
              >
                Remove
              </ConfirmButton>
            </div>
          )
        }
      </BookList>
      {editing && (
        <BookDialog
          slug={slug}
          book={editing === "new" ? null : editing}
          onDone={(changed) => (setEditing(null), changed && onChange())}
        />
      )}
      {importing && (
        <ImportBooks
          slug={slug}
          onDone={(changed) => (setImporting(false), changed && onChange())}
        />
      )}
    </div>
  )
}

function BookList({
  books,
  error,
  children,
}: {
  books: Book[] | undefined
  error: Error | null
  children?: (book: Book) => React.ReactNode
}) {
  if (!books) return <Loading error={error} />
  if (books.length === 0)
    return <p className="text-body-sm text-body">No books found.</p>
  return (
    <ul
      className="divide-y divide-hairline rounded-lg border border-hairline bg-card"
      data-testid="books"
    >
      {books.map((b) => (
        <li
          key={b.id}
          data-testid="book"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-body-sm"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ink">{b.title}</div>
            <div className="truncate text-xs text-body">
              {[b.author, b.category, b.shelf, b.isbn && `ISBN ${b.isbn}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div
            className={cn(
              "text-xs tabular-nums",
              b.available === 0 ? "text-destructive" : "text-body"
            )}
          >
            {b.available} of {b.copies} on the shelf
          </div>
          {children?.(b)}
        </li>
      ))}
    </ul>
  )
}

function BookDialog({
  slug,
  book,
  onDone,
}: {
  slug: string
  book: Book | null
  onDone: (changed: boolean) => void
}) {
  const [form, setForm] = useState({
    title: book?.title ?? "",
    author: book?.author ?? "",
    isbn: book?.isbn ?? "",
    category: book?.category ?? "",
    shelf: book?.shelf ?? "",
    copies: String(book?.copies ?? 1),
  })
  const save = useMutation({
    mutationFn: () =>
      api(book ? `/orgs/${slug}/books/${book.id}` : `/orgs/${slug}/books`, {
        method: book ? "PUT" : "POST",
        body: { ...form, copies: Number(form.copies) || 0 },
      }),
    onSuccess: () => onDone(true),
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{book ? "Edit book" : "Add book"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Title">
            <TextInput value={form.title} onChange={set("title")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Author">
              <TextInput value={form.author} onChange={set("author")} />
            </Field>
            <Field label="ISBN">
              <TextInput value={form.isbn} onChange={set("isbn")} />
            </Field>
            <Field label="Category">
              <TextInput value={form.category} onChange={set("category")} />
            </Field>
            <Field label="Shelf">
              <TextInput value={form.shelf} onChange={set("shelf")} />
            </Field>
            <Field label="Copies">
              <TextInput
                type="number"
                min={0}
                value={form.copies}
                onChange={set("copies")}
              />
            </Field>
          </div>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button
            disabled={!form.title.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportBooks({
  slug,
  onDone,
}: {
  slug: string
  onDone: (changed: boolean) => void
}) {
  const [text, setText] = useState("")
  const rows = text
    .split("\n")
    .map((line) =>
      line.split("\t").length > 1 ? line.split("\t") : line.split(",")
    )
    .map((c) => c.map((x) => x.trim()))
    .filter((c) => c.some(Boolean))
    .filter((c) => !/^title$/i.test(c[0] ?? ""))
    .map(
      ([
        title = "",
        author = "",
        isbn = "",
        category = "",
        shelf = "",
        copies = "1",
      ]) => ({
        title,
        author,
        isbn,
        category,
        shelf,
        copies: Math.max(0, Number.parseInt(copies, 10) || 1),
      })
    )
  const save = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof importBooks>>(`/orgs/${slug}/books/import`, {
        body: { rows },
      }),
  })
  const result = save.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onDone(Boolean(result?.added))}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add books from a list</DialogTitle>
          <DialogDescription>
            One per line: title, author, ISBN, category, shelf, copies. Paste
            from a spreadsheet or separate with commas; only the title is
            needed.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <p className="text-body-sm text-ink" data-testid="books-report">
            Added {result.added}
            {result.failed ? `; ${result.failed} lines had no title.` : "."}
          </p>
        ) : (
          <div className="grid gap-2">
            <TextArea
              aria-label="Books list"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "Wings of Fire, A. P. J. Abdul Kalam, 9788173711466, Biography, B2, 3"
              }
            />
            <p className="text-caption">{rows.length} books</p>
            {save.error && (
              <FormMessage
                message={{ text: save.error.message, kind: "err" }}
              />
            )}
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onDone(result.added > 0)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onDone(false)}>
                Cancel
              </Button>
              <Button
                disabled={rows.length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                Add {rows.length || ""} books
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RulesDialog({
  slug,
  settings,
  onDone,
}: {
  slug: string
  settings: Setup["settings"]
  onDone: () => void
}) {
  const [loanDays, setLoanDays] = useState(String(settings.loanDays))
  const [maxLoans, setMaxLoans] = useState(String(settings.maxLoans))
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/books/settings`, {
        method: "PUT",
        body: { loanDays: Number(loanDays), maxLoans: Number(maxLoans) },
      }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Loan rules</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Days a loan lasts">
            <TextInput
              type="number"
              min={1}
              max={365}
              value={loanDays}
              onChange={(e) => setLoanDays(e.target.value)}
            />
          </Field>
          <Field label="Books per person">
            <TextInput
              type="number"
              min={1}
              max={50}
              value={maxLoans}
              onChange={(e) => setMaxLoans(e.target.value)}
            />
          </Field>
        </div>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- a member's page ---------- */

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
    <div className="grid gap-5">
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
                <span className="text-ink">{l.title}</span>
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
