import { ImageResponse } from "next/og"

import { MARK } from "@/components/logo"

// The home-screen icon for iPhones and iPads: the mark, full bleed (iOS rounds the corners).
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: MARK.colors.tile,
      }}
    >
      {/* Inset, so the braces keep clear of the corners iOS rounds off. */}
      <svg width="140" height="140" viewBox="0 0 64 64">
        <path d={MARK.braces} fill="none" stroke={MARK.colors.braces} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={MARK.check} fill="none" stroke={MARK.colors.check} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>,
    size
  )
}
