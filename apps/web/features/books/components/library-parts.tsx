"use client"

import { useQuery } from "@tanstack/react-query"

import type {
  librarySetup,
  listBooks,
  listLoans,
} from "@/features/books/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

export type Book = ApiResult<typeof listBooks>[number]

export type Loan = ApiResult<typeof listLoans>[number]

export type Setup = ApiResult<typeof librarySetup>

export const bookCount = (n: number) => `${n} book${n === 1 ? "" : "s"}`

export const STATUS: Record<Loan["status"], string> = {
  out: "Out",
  overdue: "Overdue",
  returned: "Returned",
  lost: "Lost",
}

export function useBooks(slug: string, q: string) {
  return useQuery({
    queryKey: ["org", slug, "books", q.trim()],
    queryFn: () =>
      api<Book[]>(`/orgs/${slug}/books?q=${encodeURIComponent(q.trim())}`),
  })
}
