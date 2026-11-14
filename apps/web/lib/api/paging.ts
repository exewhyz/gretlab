import { z } from "zod"

import { ApiError } from "@/lib/api/errors"

/*
 * Long lists page on the server, all the same way:
 *
 * - `readPage(query)` checks `?page`, `?q` and `?perPage` (capped at MAX_PER_PAGE);
 * - `paged({ page, perPage, count, rows })` runs the count and the page's rows together in
 *   the database (LIMIT/OFFSET), and answers a page past the end with the last one;
 * - every paged answer has the same fields: `{ items, total, page, pages, perPage }`.
 *   Lists that had their own field names (`members`, `links`, `organizations`, `students`)
 *   keep them alongside `items`, so older callers and integrations don't break.
 *
 * Without `?page`, an endpoint keeps answering with the whole list, as before.
 */

export const MAX_PER_PAGE = 200

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || undefined),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).optional(),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

/** `?page`, `?q` and `?perPage`, checked; a bad value is a 400. */
export function readPage(query: URLSearchParams): PageQuery {
  const parsed = pageQuerySchema.safeParse({
    page: query.get("page") || undefined,
    q: query.get("q") ?? undefined,
    perPage: query.get("perPage") || undefined,
  })
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_query",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
    )
  }
  return parsed.data
}

export type Page<T> = {
  items: T[]
  total: number
  page: number
  pages: number
  perPage: number
}

/** Which page that is, given how many there are: clamped to 1…pages. */
export function pageOf(total: number, page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  return { page: at, pages, perPage, offset: (at - 1) * perPage }
}

/**
 * One page from the database: `count` and `rows(limit, offset)` run together. A page past
 * the end (the list shrank, or a hand-typed address) is answered with the last page.
 */
export async function paged<T>(opts: {
  page: number
  perPage: number
  count: () => Promise<number>
  rows: (limit: number, offset: number) => Promise<T[]>
}): Promise<Page<T>> {
  const asked = pageOf(Number.MAX_SAFE_INTEGER, opts.page, opts.perPage)
  const [total, first] = await Promise.all([
    opts.count(),
    opts.rows(opts.perPage, asked.offset),
  ])
  const at = pageOf(total, opts.page, opts.perPage)
  const items =
    at.offset === asked.offset
      ? first
      : await opts.rows(opts.perPage, at.offset)
  return { items, total, page: at.page, pages: at.pages, perPage: at.perPage }
}

/** A search term for ILIKE: matched anywhere, with `%`, `_` and `\` taken literally. */
export const likeTerm = (q: string) =>
  `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
