"use client"

import { useQuery } from "@tanstack/react-query"
import { useCallback, useMemo, useSyncExternalStore } from "react"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"

/*
 * Whose content the lists show: everything, or a chosen mix of "personal" (the platform's
 * own problems, contests and assignments, from no organization) and organizations. Kept
 * in a cookie, per browser, so every tab and page agrees. It only narrows what lists
 * show; access is still decided on the server.
 */

const COOKIE = "gl_scope"
export const PERSONAL = "personal"

/** `null` is everything; otherwise "personal" and organization slugs. */
export type Scope = readonly string[] | null

const listeners = new Set<() => void>()

function readCookie() {
  if (typeof document === "undefined") return ""
  const match = document.cookie.match(/(?:^|;\s*)gl_scope=([^;]*)/)
  return match ? decodeURIComponent(match[1]!) : ""
}

function parse(raw: string): Scope {
  const tokens = raw.split(",").filter(Boolean)
  return tokens.length ? tokens : null
}

export function writeScope(scope: Scope) {
  const value = scope?.length ? scope.join(",") : ""
  document.cookie = value
    ? `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`
    : `${COOKIE}=; path=/; max-age=0; samesite=lax`
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The current scope and a test for one item. `known` is the slugs of the organizations
 * the person is in: a saved slug they've since left is ignored, and if nothing known is
 * left the scope falls back to everything rather than an empty screen.
 */
export function useScope(known?: readonly string[]) {
  const raw = useSyncExternalStore(subscribe, readCookie, () => "")
  const scope = useMemo(() => {
    const parsed = parse(raw)
    if (!parsed || !known) return parsed
    const kept = parsed.filter((t) => t === PERSONAL || known.includes(t))
    return kept.length ? kept : null
  }, [raw, known])
  /** Whether an item from this organization (null: from none) is shown. */
  const shows = useCallback(
    (orgSlug: string | null | undefined) =>
      !scope || scope.includes(orgSlug ?? PERSONAL),
    [scope]
  )
  return { scope, shows, setScope: writeScope }
}

export interface ScopeOrg {
  slug: string
  name: string
  type: string
  status: "active" | "pending"
  canManage: boolean
}

/**
 * The scope as lists use it: the signed-in person's organizations (active ones) and the
 * test for an item. Signed out, everything shows.
 */
export function useContentScope() {
  const { data: viewer } = useViewer()
  const signedIn = Boolean(viewer?.user)
  const { data: orgs } = useQuery({
    queryKey: ["me", "orgs"],
    queryFn: () => api<ScopeOrg[]>("/me/orgs"),
    enabled: signedIn,
  })
  const active = useMemo(
    () => (orgs ?? []).filter((o) => o.status === "active"),
    [orgs]
  )
  const slugs = useMemo(() => active.map((o) => o.slug), [active])
  const { scope, shows, setScope } = useScope(orgs ? slugs : undefined)
  const off = !signedIn || active.length === 0
  const always = useCallback(() => true, [])
  return {
    orgs: active,
    scope: off ? null : scope,
    shows: off ? always : shows,
    setScope,
  }
}
