"use client"

import { useQuery } from "@tanstack/react-query"

import type { addressCheck } from "@/features/orgs/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { useDebounced } from "@/lib/use-debounced"

type Check = ApiResult<typeof addressCheck>

/**
 * Whether an organization address is free, asked once typing pauses (GET /org-address).
 * `free` is null while it's being asked, so a form can wait rather than guess.
 */
export function useAddressCheck(slug: string) {
  const settled = useDebounced(slug.trim().toLowerCase())
  const typing = settled !== slug.trim().toLowerCase()
  const { data, isFetching } = useQuery({
    queryKey: ["org-address", settled],
    queryFn: () =>
      api<Check>(`/org-address?slug=${encodeURIComponent(settled)}`),
    enabled: settled.length > 0,
    staleTime: 10_000,
  })
  const known = !typing && !isFetching && data !== undefined
  return {
    free: known ? data.free : null,
    problem: known ? data.problem : null,
  }
}

/** The line under the address field: Available, or why it can't be had. */
export function AddressStatus({
  check,
}: {
  check: ReturnType<typeof useAddressCheck>
}) {
  if (check.free === null) return null
  return (
    <p
      data-testid="address-status"
      aria-live="polite"
      className={
        check.free
          ? "-mt-2 text-caption text-success"
          : "-mt-2 text-caption text-destructive"
      }
    >
      {check.free ? "Available" : check.problem}
    </p>
  )
}
