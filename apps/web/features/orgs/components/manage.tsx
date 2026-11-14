"use client"

import { type ReactNode } from "react"

import { Loading } from "@/features/admin/components/shell"
import { OwnerProvider } from "@/features/admin/owner"
import { AuditLog } from "@/features/audit/components/audit-log"
import { OrgShell } from "@/features/home/components/org-shell"

import { useSummary } from "./manage-shared"
export { ManageRoles, PermissionChips } from "./manage-roles"
export { ManageSettings } from "./manage-settings"
export { ManageImport, parseCsv } from "./manage-import"
export { ManageMembers } from "./manage-members"
export { ManageInvites } from "./manage-invites"

export function ManageShell({
  slug,
  children,
}: {
  slug: string
  children: ReactNode
}) {
  const { data, error } = useSummary(slug)
  // The school frame (features/home/components/org-shell.tsx) draws the sidebar and header.
  return (
    <OrgShell slug={slug}>
      {data ? (
        // The shared dashboard editors work for this organization inside here.
        <OwnerProvider orgSlug={slug}>{children}</OwnerProvider>
      ) : (
        <Loading error={error} />
      )}
    </OrgShell>
  )
}

export function ManageActivity({ slug }: { slug: string }) {
  return <AuditLog base={`/orgs/${slug}/audit`} />
}
