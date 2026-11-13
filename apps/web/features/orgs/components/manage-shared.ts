"use client"

import { useQuery } from "@tanstack/react-query"
import type { KindTerms, ModuleKey, Permission } from "@workspace/judge"

import { api } from "@/lib/api/client"

import type { OrgType } from "./public"

/* Types, data hooks and tree helpers shared by the organization management screens. */

export interface Summary {
  org: {
    slug: string
    name: string
    type: OrgType
    description: string
    website: string
    listed: boolean
    joinPolicy: "open" | "approval" | "invite"
    emailDomains: string[]
    groupLevels: string[]
    active: boolean
    languages: string[] | null
    allowPaste: boolean
    moduleChoices: Partial<Record<ModuleKey, boolean>>
    modules: ModuleKey[]
    /** Modules this kind may have here, as the platform set them. */
    moduleOptions?: { key: ModuleKey; level: "optional" | "default" }[]
    kind?: { label: string; description: string; terms: KindTerms }
  }
  permissions: Permission[]
  orgWide: Permission[]
  isOwner: boolean
  counts: { members: number; pending: number; groups: number; invites: number }
}

export interface Group {
  id: string
  name: string
  description: string
  parentId: string | null
  depth: number
  members: number
  /** People sitting directly in it although it has groups inside. */
  notPlaced: number
  canManage: boolean
  canEdit?: boolean
  /** Run dates (kinds whose groups run between dates), YYYY-MM-DD. */
  startsOn?: string | null
  endsOn?: string | null
  /** Its own lead (kinds with a lead per group): a pod's mentor. */
  lead?: { id: string; name: string } | null
  /** Open to join (kinds with open groups). */
  open?: boolean
}

/** Whether this kind's groups have run dates and their own lead, and what a lead is called. */
export interface RunInfo {
  dates: boolean
  lead: boolean
  leadTerm: string
  /** Members join and leave groups themselves (a community). */
  open?: boolean
}

export interface Role {
  id: string
  name: string
  description: string
  permissions: string[]
  systemKey: string | null
  /** Made from one of the kind's suggested roles. */
  templateKey?: string | null
  assigned: number
}

export interface Member {
  userId: string
  name: string | null
  email: string
  status: "active" | "pending"
  joinedVia: string
  joinedAt: string
  shareProgress: boolean
  groupIds: string[]
  roles: {
    assignmentId: string
    roleId: string
    name: string
    systemKey: string | null
    groupId: string | null
  }[]
}

export type Message = { text: string; kind?: "ok" | "err" } | null

export const useSummary = (slug: string) =>
  useQuery({
    queryKey: ["org", slug, "manage"],
    queryFn: () => api<Summary>(`/orgs/${slug}/manage`),
  })

export const useGroups = (slug: string) =>
  useQuery({
    queryKey: ["org", slug, "groups"],
    queryFn: () =>
      api<{
        levels: string[]
        run?: RunInfo
        canManageAll: boolean
        groups: Group[]
      }>(
        `/orgs/${slug}/groups`
      ),
  })

export const useRoles = (slug: string) =>
  useQuery({
    queryKey: ["org", slug, "roles"],
    queryFn: () => api<Role[]>(`/orgs/${slug}/roles`),
  })

/** Groups in tree order: each parent followed by its children. */
export function treeOrder(groups: Group[]) {
  const out: Group[] = []
  const visit = (parentId: string | null) => {
    for (const g of groups.filter((x) => x.parentId === parentId)) {
      out.push(g)
      visit(g.id)
    }
  }
  visit(null)
  return out
}

export function groupPath(groups: Group[], id: string | null) {
  const names: string[] = []
  let current = groups.find((g) => g.id === id)
  while (current) {
    names.unshift(current.name)
    current = groups.find((g) => g.id === current!.parentId)
  }
  return names.join(" › ")
}
