"use client"

import { createContext, useContext, type ReactNode } from "react"

/**
 * Who the dashboard screens are working for: the platform (/admin) or one organization
 * (/orgs/[slug]/manage). The same editors serve both; only their addresses change.
 */
const OwnerContext = createContext<string | null>(null)

export function OwnerProvider({
  orgSlug,
  children,
}: {
  orgSlug: string | null
  children: ReactNode
}) {
  return (
    <OwnerContext.Provider value={orgSlug}>{children}</OwnerContext.Provider>
  )
}

export function useOwner() {
  const orgSlug = useContext(OwnerContext)
  return {
    orgSlug,
    /** An API path, e.g. api("/contests") is /admin/contests or /orgs/x/contests. */
    api: (path: string) =>
      orgSlug ? `/orgs/${orgSlug}${path}` : `/admin${path}`,
    /** A dashboard page, e.g. page("/contests/new"). */
    page: (path: string) =>
      orgSlug ? `/orgs/${orgSlug}/manage${path}` : `/admin${path}`,
    /** Query keys, so the platform's and each organization's data don't mix. */
    key: (...parts: unknown[]) => ["admin", orgSlug ?? "platform", ...parts],
  }
}
