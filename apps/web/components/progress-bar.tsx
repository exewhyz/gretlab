"use client"

import { useIsMutating } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

/** Navigations that never finish (an error, a download) stop showing after this long. */
const GIVE_UP_MS = 10_000

/**
 * A thin bar across the top of the page while something is on its way: a page opened from
 * a link, or a save. App Router navigations end when the new address is pushed to history,
 * so that's when it finishes.
 */
export function ProgressBar() {
  const [navigating, setNavigating] = useState(false)
  const saving = useIsMutating() > 0
  const active = navigating || saving
  const [shown, setShown] = useState(false)
  const [done, setDone] = useState(false)
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const finish = () => {
      setNavigating(false)
      if (giveUp.current) clearTimeout(giveUp.current)
    }
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const link = (event.target as Element | null)?.closest?.("a[href]")
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.target && link.target !== "_self") return
      if (link.hasAttribute("download")) return
      const url = new URL(link.href, location.href)
      if (url.origin !== location.origin) return
      // Only a different page; a jump within this one finishes at once.
      if (url.pathname === location.pathname && url.search === location.search)
        return
      if (url.pathname.startsWith("/api/")) return
      setNavigating(true)
      if (giveUp.current) clearTimeout(giveUp.current)
      giveUp.current = setTimeout(finish, GIVE_UP_MS)
    }
    const push = history.pushState.bind(history)
    const replace = history.replaceState.bind(history)
    history.pushState = (...args) => {
      push(...args)
      finish()
    }
    history.replaceState = (...args) => {
      replace(...args)
      finish()
    }
    document.addEventListener("click", onClick, true)
    window.addEventListener("popstate", finish)
    return () => {
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("popstate", finish)
      history.pushState = push
      history.replaceState = replace
      if (giveUp.current) clearTimeout(giveUp.current)
    }
  }, [])

  // A short wait before showing, so quick things don't flash; a moment at full width after.
  useEffect(() => {
    if (active) {
      setDone(false)
      const t = setTimeout(() => setShown(true), 120)
      return () => clearTimeout(t)
    }
    if (!shown) return
    setDone(true)
    const t = setTimeout(() => {
      setShown(false)
      setDone(false)
    }, 250)
    return () => clearTimeout(t)
  }, [active, shown])

  if (!shown) return null
  return (
    <div
      role="progressbar"
      aria-label={navigating ? "Loading the page" : "Saving"}
      aria-busy={!done}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
    >
      <div
        className={
          done
            ? "h-full w-full bg-primary transition-[width,opacity] duration-200 opacity-0"
            : "gl-progress h-full bg-primary"
        }
      />
    </div>
  )
}
