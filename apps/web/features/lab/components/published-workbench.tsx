"use client"

import { useParams, useRouter } from "next/navigation"

import { Workbench, type WorkbenchProps } from "./workbench"

const hrefFor = (id: string) => `/problems/${id}`

/** Binds the workbench to the /problems/[id] route (old /questions links redirect). */
export function PublishedWorkbench(
  props: Omit<WorkbenchProps, "activeId" | "hrefFor" | "onNavigate">
) {
  const { id } = useParams<{ id?: string }>()
  const router = useRouter()

  return (
    <Workbench
      {...props}
      activeId={id}
      hrefFor={hrefFor}
      onNavigate={(next) => router.push(hrefFor(next))}
    />
  )
}
