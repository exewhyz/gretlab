import { fileURLToPath } from "node:url"

import type { NextConfig } from "next"

import { contentSecurityPolicy, CSP_REPORT_PATH } from "./lib/csp"

// Enforced since 26 November 2026, after report-only showed nothing blocked on real traffic
// (lib/csp.ts). Violations are still reported to /api/csp-report and logged.
// Where uploaded files live, if not R2 over https (lib/storage.ts).
const storage = process.env.STORAGE_ENDPOINT
const CSP_HEADER = "Content-Security-Policy"
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
        // Every page but the LMS picker, whose form posts back to the LMS, and the JavaScript
        // runner's worker (below): two policies on one response would both have to pass.
        source: "/((?!lti/pick/|js-worker\\.js$).*)",
        headers: [
          { key: CSP_HEADER, value: contentSecurityPolicy({ dev, storage }) },
        ],
      },
      {
        source: "/js-worker.js",
        headers: [
          {
            key: CSP_HEADER,
            value: contentSecurityPolicy({ dev, storage, evalInWorker: true }),
          },
        ],
      },
      {
        source: "/lti/pick/:id",
        headers: [
          {
            key: CSP_HEADER,
            value: contentSecurityPolicy({
              dev,
              storage,
              formTargets: ["https:", ...(dev ? ["http:"] : [])],
            }),
          },
        ],
      },
    ]
  },
}

export default nextConfig
