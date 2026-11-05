import Script from "next/script"

import { ADSENSE_CLIENT } from "./config"

/** Loads AdSense at idle, so it never competes with Python starting up. */
export function AdScript() {
  if (!ADSENSE_CLIENT) return null
  return (
    <Script
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      strategy="lazyOnload"
      crossOrigin="anonymous"
    />
  )
}
