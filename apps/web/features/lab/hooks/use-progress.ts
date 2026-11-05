"use client"

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api/client"
import { useViewer } from "@/features/account/use-viewer"

import { useLocalStore } from "../lib/local-store"
import { progressStore } from "../lib/stores"
import type { QuestionStatus } from "../types"

/** This browser's progress with the account's on top, so "solved" follows a student around. */
export function useProgress(): Record<string, QuestionStatus> {
  const local = useLocalStore(progressStore, (progress) => progress.status)
  const { data: viewer } = useViewer()
  const { data: remote } = useQuery({
    queryKey: ["progress"],
    queryFn: () => api<Record<string, QuestionStatus>>("/me/progress"),
    enabled: Boolean(viewer?.user),
  })
  return remote ? { ...local, ...remote } : local
}
