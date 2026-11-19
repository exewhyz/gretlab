"use client"

import { useEffect, useRef, type DependencyList } from "react"

/**
 * Scrolls a box so one of its items is in view, moving only that box: never the page, so
 * opening a page with a long list or a row of tabs never jumps it.
 */
export function revealIn(container: HTMLElement, item: HTMLElement, margin = 8) {
  const box = container.getBoundingClientRect()
  const at = item.getBoundingClientRect()
  if (container.scrollHeight > container.clientHeight) {
    if (at.top < box.top + margin)
      container.scrollTop -= box.top + margin - at.top
    else if (at.bottom > box.bottom - margin)
      container.scrollTop += at.bottom - (box.bottom - margin)
  }
  if (container.scrollWidth > container.clientWidth) {
    if (at.left < box.left + margin)
      container.scrollLeft -= box.left + margin - at.left
    else if (at.right > box.right - margin)
      container.scrollLeft += at.right - (box.right - margin)
  }
}

/** The nearest box around an element that scrolls, itself included. */
function scroller(from: HTMLElement): HTMLElement | null {
  for (let el: HTMLElement | null = from; el; el = el.parentElement) {
    if (el === document.body || el === document.documentElement) return null
    const style = getComputedStyle(el)
    const scrolls = /(auto|scroll)/.test(style.overflowY + style.overflowX)
    if (scrolls && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth))
      return el
  }
  return null
}

/** The item that marks itself as current or selected. */
export const ACTIVE_ITEM =
  '[aria-current="page"], [aria-current="true"], [data-active="true"], [data-active=""], [aria-selected="true"]'

/**
 * Keeps a list's current item in view: on mount, whenever `deps` change, and (with `watch`)
 * whenever an item becomes current, such as a tab chosen with the keyboard.
 */
export function useRevealActive<T extends HTMLElement>(
  deps: DependencyList = [],
  { selector = ACTIVE_ITEM, watch = false }: { selector?: string; watch?: boolean } = {}
) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const reveal = () => {
      const item = root.querySelector<HTMLElement>(selector)
      if (!item) return
      // The page itself (body) is never scrolled.
      const box = scroller(item)
      if (box) revealIn(box, item)
    }
    const frame = requestAnimationFrame(reveal)
    if (!watch) return () => cancelAnimationFrame(frame)
    const observer = new MutationObserver(reveal)
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current", "aria-selected", "data-active"],
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}
