"use client"

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"

import type { PlatformPermission } from "@workspace/judge"

import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { EffectiveLanguage } from "@/features/settings/server"
import type { myOrganizations } from "@/features/orgs/server"
import type { myActiveExam } from "@/features/exams/server"
import type { myNotifications } from "@/features/notifications/server"

/**
 * The frame's data, sent with /me on a page's first load (`?frame=1`) so it doesn't wait for
 * /me before asking. Each part fills the cache its own query uses from then on.
 */
export const FRAME_KEYS = {
  orgs: ["me", "orgs"],
  exam: ["exam", "active"],
  notifications: ["me", "notifications"],
} as const

export interface Viewer {
  siteTitle: string
  twoFactorPending: boolean
  user: {
    id: string
    handle: string
    email: string
    name: string | null
    role: "student" | "teacher" | "admin"
    teaches: boolean
    parent: boolean
    security: { twoFactor: boolean; mustEnroll: boolean }
    platform: {
      permissions: PlatformPermission[]
      role: string | null
      owner: boolean
    }
  } | null
  features: {
    serverExecution: boolean
    browserExecution: boolean
    showSolutions: boolean
    contests: boolean
    assignments: boolean
    daily: boolean
    lists: boolean
    profiles: boolean
    practice: boolean
  }
  languages: EffectiveLanguage[]
  frame: {
    orgs: ApiResult<typeof myOrganizations>
    exam: ApiResult<typeof myActiveExam>
    notifications: ApiResult<typeof myNotifications>
  } | null
}

async function fetchViewer(client: QueryClient) {
  // Only while the frame has nothing yet: later refreshes of /me stay as light as before.
  const needsFrame = client.getQueryData(FRAME_KEYS.notifications) === undefined
  const viewer = await api<Viewer>(needsFrame ? "/me?frame=1" : "/me")
  if (viewer.frame) {
    client.setQueryData(FRAME_KEYS.orgs, viewer.frame.orgs)
    client.setQueryData(FRAME_KEYS.exam, viewer.frame.exam)
    client.setQueryData(FRAME_KEYS.notifications, viewer.frame.notifications)
  }
  return viewer
}

export function useViewer() {
  const client = useQueryClient()
  return useQuery({
    queryKey: ["me"],
    queryFn: () => fetchViewer(client),
    staleTime: 60_000,
  })
}
