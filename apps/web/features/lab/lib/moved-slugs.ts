import { workspaceStore } from "@/features/editor/workspace-store"

import { progressStore } from "./stores"

/*
 * Progress, code and editor workspaces saved in this browser are keyed by the problem's slug.
 * When problems move to a new address (p2 → integer-operations), this carries what was saved
 * under the old slug over to the new one, once. Something already saved under the new slug
 * wins, so it never overwrites newer work.
 */
export function carryOverSlugs(moved: Record<string, string>) {
  const pairs = Object.entries(moved)
  if (pairs.length === 0) return
  let progressChanged = false
  progressStore.update((progress) => {
    const status = { ...progress.status }
    const code = { ...progress.code }
    for (const [from, to] of pairs) {
      if (from in status) {
        if (!(to in status)) status[to] = status[from]!
        delete status[from]
        progressChanged = true
      }
      if (from in code) {
        if (!(to in code)) code[to] = code[from]!
        delete code[from]
        progressChanged = true
      }
    }
    return progressChanged ? { status, code } : progress
  })
  if (progressChanged) progressStore.persist()

  let workspacesChanged = false
  workspaceStore.update((workspaces) => {
    const next = { ...workspaces }
    for (const [from, to] of pairs) {
      if (!(from in next)) continue
      if (!(to in next)) next[to] = next[from]!
      delete next[from]
      workspacesChanged = true
    }
    return workspacesChanged ? next : workspaces
  })
  if (workspacesChanged) workspaceStore.persist()
}
