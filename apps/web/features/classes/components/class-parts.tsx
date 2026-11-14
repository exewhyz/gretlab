"use client"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */

export interface Reach {
  kind: "class" | "above" | "narrow" | "org"
  label: string
}

export interface Overview {
  org: { slug: string; name: string }
  group: {
    id: string
    name: string
    level: string | null
    path: { id: string; name: string }[]
  }
  children: { id: string; name: string; members: number }[]
  students: number
  teachers: { name: string; roles: string[] }[]
  viewer: { teaches: boolean; sits: boolean }
  modules: string[]
  can: {
    assignments: boolean
    contests: boolean
    notices: boolean
    grades: boolean
    people: boolean
    log: boolean
    reports: boolean
  }
}

export function ReachChip({ reach }: { reach: Reach }) {
  if (reach.kind === "class") return null
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
      {reach.label}
    </span>
  )
}
