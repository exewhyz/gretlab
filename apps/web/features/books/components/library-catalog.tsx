"use client"

import { useMutation } from "@tanstack/react-query"
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
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Loading } from "@/features/admin/components/shell"

import type { importBooks } from "@/features/books/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { Book, Setup, useBooks } from "./library-parts"

export function Catalog({
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
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

export function BookList({
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
            <div className="font-medium [overflow-wrap:anywhere] text-ink">
              {b.title}
            </div>
            <div className="text-xs [overflow-wrap:anywhere] text-body">
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

export function BookDialog({
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

export function ImportBooks({
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

export function RulesDialog({
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
