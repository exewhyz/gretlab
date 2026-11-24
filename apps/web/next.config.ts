import { fileURLToPath } from "node:url"

import type { NextConfig } from "next"

import { contentSecurityPolicy, CSP_REPORT_PATH } from "./lib/csp"

// Report-only until the reports from real traffic are clean (lib/csp.ts); then
// "Content-Security-Policy".
const CSP_HEADER = "Content-Security-Policy-Report-Only"
const dev = process.env.NODE_ENV === "development"

const nextConfig: NextConfig = {
  // A self-contained server for the container image; see apps/web/Dockerfile.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@workspace/ui", "@workspace/db", "@workspace/judge"],
  poweredByHeader: false,
  // Upgrade reminders from `next dev` and `next build` only for security releases.
  experimental: { agentUpgrade: "security" },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Reporting-Endpoints", value: `csp="${CSP_REPORT_PATH}"` },
        ],
      },
      {
        // Every page but the LMS picker, whose form posts back to the LMS.
        source: "/((?!lti/pick/).*)",
        headers: [{ key: CSP_HEADER, value: contentSecurityPolicy({ dev }) }],
      },
      {
        source: "/lti/pick/:id",
        headers: [
          {
            key: CSP_HEADER,
            value: contentSecurityPolicy({
              dev,
              formTargets: ["https:", ...(dev ? ["http:"] : [])],
            }),
          },
        ],
      },
    ]
  },
}

export default nextConfig
