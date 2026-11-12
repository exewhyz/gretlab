import {
  getDb,
  libraryBooks,
  libraryLoans,
  orgMembers,
  organizations,
  sql,
  users,
  type User,
} from "@workspace/db"
import {
  addDays,
  available,
  cannotBorrow,
  enabledModules,
  isDay,
  loanStatus,
  readLibrarySettings,
  type Permission,
} from "@workspace/judge"
import { z } from "zod"

import { today } from "@/features/catalog/server"
import {
  canFor,
  orgContext,
  writeAudit,
  type OrgContext,
} from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * The Library module: an organization's books (`library_books`, with a number of copies)
 * and loans to its members (`library_loans`). "Keep the catalog" (`library.catalog`) adds
 * and edits books and sets the loan rules (`module_settings.library`: loan days, books per
 * person); "Lend and take back books" (`library.lend`) issues, renews, takes back and marks
 * lost. Both are organization-wide. Members browse the catalog and see their own loans;
 * reminders for books due or overdue are worked out when the bell is read. Rules in
 * packages/judge/src/library.ts.
 */

const { and, asc, count, desc, eq, ilike, inArray, or } = sql

export const bookSchema = z.object({
  title: z.string().trim().min(1, "Give the book a title").max(300),
  author: z.string().trim().max(200).default(""),
  isbn: z.string().trim().max(20).default(""),
  category: z.string().trim().max(80).default(""),
  shelf: z.string().trim().max(40).default(""),
  copies: z.number().int().min(0).max(10_000).default(1),
})

export const booksImportSchema = z.object({
  rows: z
    .array(bookSchema.partial({ title: true }))
    .min(1)
    .max(5000),
})

export const librarySettingsSchema = z.object({
  loanDays: z.number().int().min(1).max(365),
  maxLoans: z.number().int().min(1).max(50),
})

export const issueSchema = z.object({
  bookId: z.uuid(),
  userId: z.uuid(),
  /** Defaults to today plus the loan period. */
  dueOn: z.string().optional(),
})

export const loanActionSchema = z.object({
  action: z.enum(["return", "renew", "lost"]),
})

const forbidden = (message: string) => new ApiError(403, "forbidden", message)

function needModule(ctx: OrgContext) {
  if (!enabledModules(ctx.org.type, ctx.org.modules).has("library")) {
    throw notFound("The library isn't switched on for this organization.")
  }
}

const may = (ctx: OrgContext, permission: Permission) =>
  canFor(ctx, permission, [])

function need(ctx: OrgContext, permission: Permission, what: string) {
  if (!may(ctx, permission)) throw forbidden(`${what} isn't part of your role.`)
}

const isMember = (ctx: OrgContext) => ctx.membership?.status === "active"

/** Copies out on loan, per book. */
async function outByBook(bookIds: string[]) {
  if (bookIds.length === 0) return new Map<string, number>()
  const rows = await getDb()
    .select({ bookId: libraryLoans.bookId, n: count() })
    .from(libraryLoans)
    .where(
      and(inArray(libraryLoans.bookId, bookIds), eq(libraryLoans.status, "out"))
    )
    .groupBy(libraryLoans.bookId)
  return new Map(rows.map((r) => [r.bookId, Number(r.n)]))
}

/* ---------- the catalog ---------- */

/** The library's front page for staff: what they may do, its rules and its numbers. */
export async function librarySetup(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  const can = {
    catalog: may(ctx, "library.catalog"),
    lend: may(ctx, "library.lend"),
  }
  if (!can.catalog && !can.lend)
    throw forbidden("Running the library isn't part of your role.")
  const db = getDb()
  const day = await today()
  const [[books], loans] = await Promise.all([
    db
      .select({
        titles: count(),
        copies:
          sql.sql<number>`coalesce(sum(${libraryBooks.copies}), 0)`.mapWith(
            Number
          ),
      })
      .from(libraryBooks)
      .where(eq(libraryBooks.orgId, ctx.org.id)),
    db
      .select({ dueOn: libraryLoans.dueOn })
      .from(libraryLoans)
      .where(
        and(eq(libraryLoans.orgId, ctx.org.id), eq(libraryLoans.status, "out"))
      ),
  ])
  return {
    can,
    today: day,
    settings: readLibrarySettings(ctx.org.moduleSettings),
    counts: {
      titles: Number(books?.titles ?? 0),
      copies: books?.copies ?? 0,
      out: loans.length,
      overdue: loans.filter((l) => l.dueOn < day).length,
    },
  }
}

/** Books matching a search, with copies on the shelf. Members and library staff. */
export async function listBooks(slug: string, user: User, q: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (
    !isMember(ctx) &&
    !may(ctx, "library.catalog") &&
    !may(ctx, "library.lend")
  ) {
    throw notFound("Not found")
  }
  const term = q.trim()
  const rows = await getDb()
    .select()
    .from(libraryBooks)
    .where(
      and(
        eq(libraryBooks.orgId, ctx.org.id),
        term
          ? or(
              ilike(libraryBooks.title, `%${term}%`),
              ilike(libraryBooks.author, `%${term}%`),
              ilike(libraryBooks.isbn, `%${term}%`),
              ilike(libraryBooks.category, `%${term}%`)
            )
          : undefined
      )
    )
    .orderBy(asc(libraryBooks.title))
    .limit(300)
  const out = await outByBook(rows.map((r) => r.id))
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    isbn: b.isbn,
    category: b.category,
    shelf: b.shelf,
    copies: b.copies,
    out: out.get(b.id) ?? 0,
    available: available(b.copies, out.get(b.id) ?? 0),
  }))
}

async function bookOf(ctx: OrgContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Book not found")
  const [book] = await getDb()
    .select()
    .from(libraryBooks)
    .where(and(eq(libraryBooks.id, id), eq(libraryBooks.orgId, ctx.org.id)))
  if (!book) throw notFound("Book not found")
  return book
}

export async function addBook(
  slug: string,
  user: User,
  input: z.infer<typeof bookSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.catalog", "Keeping the catalog")
  const [book] = await getDb()
    .insert(libraryBooks)
    .values({ ...input, orgId: ctx.org.id })
    .returning()
  await writeAudit(
    ctx,
    "library.book_add",
    `Added "${input.title}" to the library`,
    { copies: input.copies }
  )
  return book
}

export async function updateBook(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof bookSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.catalog", "Keeping the catalog")
  const book = await bookOf(ctx, id)
  const out = (await outByBook([id])).get(id) ?? 0
  if (input.copies < out) {
    throw new ApiError(
      400,
      "copies_out",
      `${out} copies are on loan; there can't be fewer than that.`
    )
  }
  const [saved] = await getDb()
    .update(libraryBooks)
    .set(input)
    .where(eq(libraryBooks.id, id))
    .returning()
  await writeAudit(ctx, "library.book_edit", `Edited "${book.title}"`, {
    copies: input.copies,
  })
  return saved
}

export async function deleteBook(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.catalog", "Keeping the catalog")
  const book = await bookOf(ctx, id)
  if ((await outByBook([id])).get(id)) {
    throw new ApiError(
      400,
      "on_loan",
      "Some copies are on loan. Take them back first."
    )
  }
  await getDb().delete(libraryBooks).where(eq(libraryBooks.id, id))
  await writeAudit(
    ctx,
    "library.book_delete",
    `Removed "${book.title}" from the library`
  )
  return { deleted: true }
}

/** Books from a pasted list; a line without a title is reported, the rest are added. */
export async function importBooks(
  slug: string,
  user: User,
  input: z.infer<typeof booksImportSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.catalog", "Keeping the catalog")
  const good = input.rows.filter((r) => r.title)
  const report = input.rows.flatMap((r, i) =>
    r.title ? [] : [{ line: i + 1, note: "No title" }]
  )
  if (good.length) {
    await getDb()
      .insert(libraryBooks)
      .values(good.map((r) => ({ ...r, title: r.title!, orgId: ctx.org.id })))
    await writeAudit(
      ctx,
      "library.import",
      `Added ${good.length} books from a list`
    )
  }
  return { added: good.length, failed: report.length, report }
}

export async function saveLibrarySettings(
  slug: string,
  user: User,
  input: z.infer<typeof librarySettingsSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.catalog", "Setting the loan rules")
  await getDb()
    .update(organizations)
    .set({
      moduleSettings: {
        ...((ctx.org.moduleSettings as object | null) ?? {}),
        library: input,
      },
    })
    .where(eq(organizations.id, ctx.org.id))
  await writeAudit(
    ctx,
    "library.settings",
    `Loans last ${input.loanDays} days, up to ${input.maxLoans} books each`
  )
  return input
}

/* ---------- loans ---------- */

const loanColumns = {
  id: libraryLoans.id,
  bookId: libraryLoans.bookId,
  title: libraryBooks.title,
  author: libraryBooks.author,
  userId: libraryLoans.userId,
  name: users.name,
  email: users.email,
  issuedOn: libraryLoans.issuedOn,
  dueOn: libraryLoans.dueOn,
  returnedOn: libraryLoans.returnedOn,
  status: libraryLoans.status,
}

/** Loans for the desk: those out (overdue first), or everything recent. */
export async function listLoans(
  slug: string,
  user: User,
  show: string,
  q: string
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.lend", "Lending books")
  const day = await today()
  const term = q.trim()
  const rows = await getDb()
    .select(loanColumns)
    .from(libraryLoans)
    .innerJoin(libraryBooks, eq(libraryLoans.bookId, libraryBooks.id))
    .innerJoin(users, eq(libraryLoans.userId, users.id))
    .where(
      and(
        eq(libraryLoans.orgId, ctx.org.id),
        show === "all" ? undefined : eq(libraryLoans.status, "out"),
        term
          ? or(
              ilike(libraryBooks.title, `%${term}%`),
              ilike(users.name, `%${term}%`),
              ilike(users.email, `%${term}%`)
            )
          : undefined
      )
    )
    .orderBy(
      show === "all" ? desc(libraryLoans.createdAt) : asc(libraryLoans.dueOn)
    )
    .limit(500)
  return rows
    .map((r) => ({ ...r, name: r.name ?? r.email, status: loanStatus(r, day) }))
    .filter((r) => show !== "overdue" || r.status === "overdue")
}

/** Members to lend to, matching a search. */
export async function searchBorrowers(slug: string, user: User, q: string) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.lend", "Lending books")
  const term = q.trim()
  if (term.length < 2) return []
  const people = await getDb()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        eq(orgMembers.status, "active"),
        or(ilike(users.name, `%${term}%`), ilike(users.email, `%${term}%`))
      )
    )
    .orderBy(asc(users.name))
    .limit(20)
  const holding = people.length
    ? await getDb()
        .select({ userId: libraryLoans.userId, n: count() })
        .from(libraryLoans)
        .where(
          and(
            eq(libraryLoans.orgId, ctx.org.id),
            eq(libraryLoans.status, "out"),
            inArray(
              libraryLoans.userId,
              people.map((p) => p.id)
            )
          )
        )
        .groupBy(libraryLoans.userId)
    : []
  return people.map((p) => ({
    id: p.id,
    name: p.name ?? p.email,
    email: p.email,
    holding: Number(holding.find((h) => h.userId === p.id)?.n ?? 0),
  }))
}

const WHY = {
  has_it: "They already have this book.",
  unavailable: "Every copy is out.",
  limit: "They already hold as many books as the library allows.",
} as const

export async function issueBook(
  slug: string,
  user: User,
  input: z.infer<typeof issueSchema>
) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.lend", "Lending books")
  const book = await bookOf(ctx, input.bookId)
  const db = getDb()
  const [member] = await db
    .select({ name: users.name, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(
      and(
        eq(orgMembers.orgId, ctx.org.id),
        eq(orgMembers.userId, input.userId),
        eq(orgMembers.status, "active")
      )
    )
  if (!member) throw notFound("Member not found")
  const day = await today()
  const rules = readLibrarySettings(ctx.org.moduleSettings)
  const dueOn = input.dueOn ?? addDays(day, rules.loanDays)
  if (!isDay(dueOn) || dueOn < day) {
    throw new ApiError(400, "bad_due", "Give a due date from today on.")
  }
  await db.transaction(async (tx) => {
    // One desk at a time per book, so two can't lend its last copy together.
    await tx.execute(
      sql.sql`select id from ${libraryBooks} where ${libraryBooks.id} = ${book.id} for update`
    )
    const open = await tx
      .select({ bookId: libraryLoans.bookId, userId: libraryLoans.userId })
      .from(libraryLoans)
      .where(
        and(
          eq(libraryLoans.orgId, ctx.org.id),
          eq(libraryLoans.status, "out"),
          or(
            eq(libraryLoans.bookId, book.id),
            eq(libraryLoans.userId, input.userId)
          )
        )
      )
    const why = cannotBorrow({
      holding: open.filter((l) => l.userId === input.userId).length,
      maxLoans: rules.maxLoans,
      copiesFree: available(
        book.copies,
        open.filter((l) => l.bookId === book.id).length
      ),
      alreadyHasIt: open.some(
        (l) => l.bookId === book.id && l.userId === input.userId
      ),
    })
    if (why) throw new ApiError(409, why, WHY[why])
    await tx.insert(libraryLoans).values({
      orgId: ctx.org.id,
      bookId: book.id,
      userId: input.userId,
      issuedOn: day,
      dueOn,
      issuedBy: user.id,
    })
  })
  await writeAudit(
    ctx,
    "library.issue",
    `Lent "${book.title}" to ${member.name ?? member.email}, due ${dueOn}`
  )
  return { issued: true, dueOn }
}

/** Takes a book back, renews it, or marks it lost (one copy fewer). */
export async function actOnLoan(
  slug: string,
  user: User,
  id: string,
  input: z.infer<typeof loanActionSchema>
) {
  if (!z.uuid().safeParse(id).success) throw notFound("Loan not found")
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  need(ctx, "library.lend", "Lending books")
  const db = getDb()
  const [loan] = await db
    .select(loanColumns)
    .from(libraryLoans)
    .innerJoin(libraryBooks, eq(libraryLoans.bookId, libraryBooks.id))
    .innerJoin(users, eq(libraryLoans.userId, users.id))
    .where(and(eq(libraryLoans.id, id), eq(libraryLoans.orgId, ctx.org.id)))
  if (!loan) throw notFound("Loan not found")
  if (loan.status !== "out")
    throw new ApiError(400, "closed", "That loan is already closed.")
  const day = await today()
  const who = loan.name ?? loan.email
  if (input.action === "renew") {
    const rules = readLibrarySettings(ctx.org.moduleSettings)
    const dueOn = addDays(loan.dueOn > day ? loan.dueOn : day, rules.loanDays)
    await db.update(libraryLoans).set({ dueOn }).where(eq(libraryLoans.id, id))
    await writeAudit(
      ctx,
      "library.renew",
      `Renewed "${loan.title}" for ${who}, now due ${dueOn}`
    )
    return { dueOn }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(libraryLoans)
      .set({
        status: input.action === "lost" ? "lost" : "returned",
        returnedOn: day,
      })
      .where(eq(libraryLoans.id, id))
    if (input.action === "lost") {
      await tx
        .update(libraryBooks)
        .set({ copies: sql.sql`greatest(${libraryBooks.copies} - 1, 0)` })
        .where(eq(libraryBooks.id, loan.bookId))
    }
  })
  await writeAudit(
    ctx,
    input.action === "lost" ? "library.lost" : "library.return",
    input.action === "lost"
      ? `Marked "${loan.title}" lost by ${who}`
      : `${who} returned "${loan.title}"`
  )
  return { closed: true }
}

/* ---------- a member's own ---------- */

/** A person's books out in one organization. */
export async function loansOf(orgId: string, userId: string) {
  const day = await today()
  const rows = await getDb()
    .select(loanColumns)
    .from(libraryLoans)
    .innerJoin(libraryBooks, eq(libraryLoans.bookId, libraryBooks.id))
    .innerJoin(users, eq(libraryLoans.userId, users.id))
    .where(
      and(
        eq(libraryLoans.orgId, orgId),
        eq(libraryLoans.userId, userId),
        eq(libraryLoans.status, "out")
      )
    )
    .orderBy(asc(libraryLoans.dueOn))
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    issuedOn: r.issuedOn,
    dueOn: r.dueOn,
    status: loanStatus(r, day),
  }))
}

/** The member's library page: their loans and the rules. */
export async function myLibrary(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  needModule(ctx)
  if (!isMember(ctx)) throw notFound("Not found")
  return {
    org: { name: ctx.org.name },
    settings: readLibrarySettings(ctx.org.moduleSettings),
    loans: await loansOf(ctx.org.id, user.id),
  }
}

/** Books due within a day, or overdue, across every library this person borrows from. */
export async function dueLoans(userId: string) {
  const day = await today()
  const soon = addDays(day, 1)
  return getDb()
    .select({
      id: libraryLoans.id,
      title: libraryBooks.title,
      dueOn: libraryLoans.dueOn,
      slug: organizations.slug,
      type: organizations.type,
      modules: organizations.modules,
    })
    .from(libraryLoans)
    .innerJoin(libraryBooks, eq(libraryLoans.bookId, libraryBooks.id))
    .innerJoin(organizations, eq(libraryLoans.orgId, organizations.id))
    .where(
      and(
        eq(libraryLoans.userId, userId),
        eq(libraryLoans.status, "out"),
        sql.lte(libraryLoans.dueOn, soon)
      )
    )
    .then((rows) =>
      rows
        .filter((r) => enabledModules(r.type, r.modules).has("library"))
        .map((r) => ({ ...r, overdue: r.dueOn < day }))
    )
}
