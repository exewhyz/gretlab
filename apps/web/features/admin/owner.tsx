"use client"

import { useQuery } from "@tanstack/react-query"
import { createContext, useContext, type ReactNode } from "react"

import {
  grantsPlatformPermission,
  type Permission,
  type PlatformPermission,
} from "@workspace/judge"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

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
  const { data: viewer } = useViewer()
  // The organization's shell (already loaded by its frame): what this person holds there.
  const { data: shell } = useQuery({
    queryKey: ["org", orgSlug, "shell"],
    queryFn: () => api<{ permissions: string[] }>(`/orgs/${orgSlug}/shell`),
    enabled: orgSlug !== null,
  })
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
    /**
     * Whether this person may do something here: the organization's permission (held
     * anywhere in it) on its pages, the platform's on the platform's. For showing a
     * button only when its action would be allowed; the server checks again.
     */
    can: (org: Permission, platform: PlatformPermission) =>
      orgSlug
        ? (shell?.permissions.includes(org) ?? false)
        : grantsPlatformPermission(
            viewer?.user?.platform.permissions ?? [],
            platform
          ),
  }
}
