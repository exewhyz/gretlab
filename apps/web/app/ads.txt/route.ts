import { ADSENSE_CLIENT } from "@/features/ads/config"

export const dynamic = "force-static"

/** Authorizes this site's ad inventory. Google's seller id is the same for everyone. */
export function GET() {
  if (!ADSENSE_CLIENT) return new Response("Not found", { status: 404 })
  const publisher = ADSENSE_CLIENT.replace(/^ca-/, "")
  return new Response(`google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { "Content-Type": "text/plain" },
  })
}
