"use client"

import { usePathname } from "next/navigation"
import { useSyncExternalStore } from "react"

/*
 * Learn or Teach: which half of the site the header shows to someone who does both.
 * Students only ever learn. Pages that belong to one mode switch to it, so the header
 * always matches the page; elsewhere the last choice holds (a per-browser cookie).
 */

export type Mode = "learn" | "teach"

const listeners = new Set<() => void>()

function readCookie() {
  if (typeof document === "undefined") return ""
  return document.cookie.match(/(?:^|;\s*)gl_mode=(learn|teach)/)?.[1] ?? ""
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function writeMode(mode: Mode) {
  document.cookie = `gl_mode=${mode}; path=/; max-age=31536000; samesite=lax`
  listeners.forEach((listener) => listener())
}

const TEACH_PAGES = ["/teach", "/admin"]
const LEARN_PAGES = [
  "/problems",
  "/classes",
  "/assignments",
  "/contests",
  "/leaderboard",
  "/u/",
  "/lists",
  "/submissions",
]

/** The mode a page belongs to, or null for pages in both (a class, the playground). */
export function modeOfPage(pathname: string): Mode | null {
  const under = (prefix: string) =>
    pathname === prefix ||
    pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")
  if (TEACH_PAGES.some(under) || /^\/orgs\/[^/]+\/manage(\/|$)/.test(pathname))
    return "teach"
  if (LEARN_PAGES.some(under)) return "learn"
  return null
}

/** The mode to show; `canTeach` false means always "learn". */
export function useMode(canTeach: boolean): Mode {
  const pathname = usePathname()
  const stored = useSyncExternalStore(subscribe, readCookie, () => "")
  if (!canTeach) return "learn"
  return modeOfPage(pathname) ?? (stored === "teach" ? "teach" : "learn")
}
