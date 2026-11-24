/*
 * The Content-Security-Policy (AGENTS.md › Security headers): an allowlist, the owner's choice
 * (24 November 2026), so pages stay prebuilt and cached. Scripts come only from GretLab and the
 * services it uses; nothing may frame the site; forms post only here; the browser sends data
 * only to known places. Inline scripts are allowed ('unsafe-inline'): Next's own and the page
 * data need it without per-request nonces, and statements render markdown with raw HTML shown
 * as text, so there's no way to inject one through content.
 *
 * Sent report-only first (CSP_ENFORCE unset): browsers report what it would block to
 * /api/csp-report, which logs it, and nothing breaks. Enforced once the reports are clean.
 * Imported by next.config.ts, so it imports nothing.
 */

/** Razorpay's checkout: its script, its frames, its API. */
const RAZORPAY = {
  script: ["https://checkout.razorpay.com"],
  frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com"],
}

/** Pyodide (Python in the browser), loaded by public/py-worker.js. */
const PYODIDE = ["https://cdn.jsdelivr.net"]

/** Google AdSense on public practice pages, and its measurement. */
const ADS = {
  script: [
    "https://pagead2.googlesyndication.com",
    "https://*.googlesyndication.com",
    "https://*.doubleclick.net",
    "https://*.google.com",
    "https://*.gstatic.com",
    "https://*.adtrafficquality.google",
    "https://fundingchoicesmessages.google.com",
  ],
  frame: [
    "https://*.googlesyndication.com",
    "https://*.doubleclick.net",
    "https://*.google.com",
    "https://*.adtrafficquality.google",
  ],
  connect: [
    "https://*.googlesyndication.com",
    "https://*.doubleclick.net",
    "https://*.google.com",
    "https://*.adtrafficquality.google",
  ],
}

export const CSP_REPORT_PATH = "/api/csp-report"

/**
 * The policy. `formTargets` widens form-action for the one page that posts to another site
 * (an LMS's deep-link return, app/lti/pick).
 */
export function contentSecurityPolicy({
  dev = false,
  formTargets = [] as string[],
} = {}) {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      // Pyodide compiles WebAssembly; React's development build uses eval.
      "'wasm-unsafe-eval'",
      ...(dev ? ["'unsafe-eval'"] : []),
      ...RAZORPAY.script,
      ...PYODIDE,
      ...ADS.script,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Images in statements are on Cloudflare R2 behind signed links; ads bring their own.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...RAZORPAY.connect,
      ...PYODIDE,
      ...ADS.connect,
      ...(dev ? ["ws:"] : []),
    ],
    "frame-src": ["'self'", ...RAZORPAY.frame, ...ADS.frame],
    // Monaco and Pyodide run in workers, some made from blob: addresses.
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...formTargets],
    "frame-ancestors": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
    "report-to": ["csp"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ")
}
