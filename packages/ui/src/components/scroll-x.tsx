"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@workspace/ui/lib/utils"

/*
 * Content wider than its column (a table on a phone, a long grid): scrolled sideways
 * inside its box, never by the page.
 *
 * - The scrollbar is always drawn, so people can see there's more, on every device
 *   (macOS hides native ones until you scroll). It has its own strip under the content,
 *   reserved only when there is something to scroll, so it never covers the last row.
 * - A soft shadow shows on each side that has more to see (Base UI marks the root with
 *   data-overflow-x-start / -end), so a cut-off column reads as "scroll", not "missing".
 * - `pinFirst` keeps a table's first column (who or what the row is) in place while the
 *   rest scrolls under it. Pinned cells take `--pin-head` / `--pin-body` (default: the card)
 *   so a tinted header stays opaque.
 */
function ScrollX({
  className,
  viewportClassName,
  pinFirst = false,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string
  /** Keep each row's first cell in view while the table scrolls sideways. */
  pinFirst?: boolean
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-x"
      data-pin-first={pinFirst || undefined}
      className={cn("group/scroll-x relative min-w-0", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-x-viewport"
        // Room for the scrollbar under the content, only when it can scroll.
        className={cn(
          "w-full overscroll-x-contain rounded-[inherit] outline-none group-data-has-overflow-x/scroll-x:pb-3 focus-visible:ring-2 focus-visible:ring-ring/50",
          pinFirst &&
            // The pinned cells need the surface behind them, and a rule once content passes under.
            // On phones the pinned column wraps within 45% of the width, so the rest has room.
            "[&_tr>*:first-child]:bg-[var(--pin-body,var(--card))] [&_thead_tr>*:first-child]:bg-[var(--pin-head,var(--card))] [&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[1] group-data-overflow-x-start/scroll-x:[&_tr>*:first-child]:shadow-[1px_0_0_var(--hairline)] max-sm:[&_tr>*:first-child]:max-w-[45vw] max-sm:[&_tr>*:first-child]:min-w-[45vw] max-sm:[&_tr>*:first-child]:[overflow-wrap:anywhere] max-sm:[&_tr>*:first-child]:whitespace-normal",
          viewportClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {/* "More this way": shadows on the sides that have more to see. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-6 bg-gradient-to-l from-foreground/[0.07] to-transparent opacity-0 transition-opacity group-data-overflow-x-end/scroll-x:opacity-100"
      />
      {!pinFirst && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-6 bg-gradient-to-r from-foreground/[0.07] to-transparent opacity-0 transition-opacity group-data-overflow-x-start/scroll-x:opacity-100"
        />
      )}
      <ScrollAreaPrimitive.Scrollbar
        orientation="horizontal"
        data-slot="scroll-x-scrollbar"
        className="z-[3] flex h-2.5 touch-none flex-col p-0.5 select-none"
      >
        <ScrollAreaPrimitive.Thumb
          data-slot="scroll-x-thumb"
          className="rounded-full bg-hairline-strong transition-colors hover:bg-muted-foreground active:bg-muted-foreground"
        />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}

export { ScrollX }
