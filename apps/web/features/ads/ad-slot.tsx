"use client"

import { useEffect, useRef, type CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  AD_DWELL_MS,
  AD_PLACEMENTS,
  ADSENSE_CLIENT,
  type AdPlacement,
} from "./config"

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

const IS_DEV = process.env.NODE_ENV === "development"

/**
 * One ad unit, requested only once it has stayed on screen for a moment and never
 * refreshed. It disappears entirely if it isn't configured or no ad is available.
 */
export function AdSlot({
  placement,
  className,
}: {
  placement: AdPlacement
  className?: string
}) {
  const config = AD_PLACEMENTS[placement]
  const { slot, visibility, minHeight } = config
  const size = "size" in config ? config.size : undefined
  const format = "format" in config ? config.format : undefined
  const isConfigured = Boolean(ADSENSE_CLIENT && slot)
  const container = useRef<HTMLElement>(null)
  const requested = useRef(false)

  useEffect(() => {
    const element = container.current
    if (!isConfigured || !element || requested.current) return

    let dwell: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(dwell)
        if (!entry?.isIntersecting) return
        dwell = setTimeout(() => {
          requested.current = true
          observer.disconnect()
          // adsbygoogle.js drains this queue, even if it loads afterwards.
          window.adsbygoogle = window.adsbygoogle ?? []
          window.adsbygoogle.push({})
        }, AD_DWELL_MS)
      },
      { threshold: 0.5 }
    )
    observer.observe(element)
    return () => {
      clearTimeout(dwell)
      observer.disconnect()
    }
  }, [isConfigured])

  if (!isConfigured && !IS_DEV) return null

  const frame: CSSProperties = size
    ? { display: "inline-block", width: size.width, height: size.height }
    : { display: "block", minHeight }

  return (
    <aside
      ref={container}
      aria-label="Advertisement"
      data-ad-placement={placement}
      className={cn(
        visibility,
        "border-t border-hairline p-3 text-center has-[ins[data-ad-status=unfilled]]:hidden",
        className
      )}
    >
      <div className="mb-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        Advertisement
      </div>
      {isConfigured ? (
        <ins
          className="adsbygoogle"
          style={frame}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          {...(format && {
            "data-ad-format": format,
            "data-full-width-responsive": "true",
          })}
        />
      ) : (
        // Development only, to see the layout before an AdSense account exists.
        <div
          style={frame}
          className="content-center rounded-sm border border-dashed border-hairline-strong text-xs text-muted-foreground"
        >
          {placement} ad
        </div>
      )}
    </aside>
  )
}
