"use client"

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api/client"
import type { EffectiveLanguage } from "@/features/settings/server"

export interface Viewer {
  siteTitle: string
  user: {
    id: string
    handle: string
    email: string
    name: string | null
    role: "student" | "teacher" | "admin"
    teaches: boolean
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
}

export function useViewer() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<Viewer>("/me"),
    staleTime: 60_000,
  })
}
