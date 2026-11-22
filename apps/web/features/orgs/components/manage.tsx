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
  // Asked at once, beside the page's own data (not before it); a page that needs it waits for
  // it itself. A refusal (403, 404) still shows the access page in place of the page.
  const { error } = useSummary(slug)
  // The school frame (features/home/components/org-shell.tsx) draws the sidebar and header.
  return (
    <OrgShell slug={slug}>
      {error ? (
        <Loading error={error} />
      ) : (
        // The shared dashboard editors work for this organization inside here.
        <OwnerProvider orgSlug={slug}>{children}</OwnerProvider>
      )}
    </OrgShell>
  )
}

export function ManageActivity({ slug }: { slug: string }) {
  return <AuditLog base={`/orgs/${slug}/audit`} />
}
