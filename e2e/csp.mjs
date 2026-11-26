/**
 * The Content-Security-Policy (lib/csp.ts): every page carries it, enforced, the LMS picker may post its form to an LMS, browsers' reports are
 * taken in both formats and anything malformed is refused, and the site's own pages break none
 * of it: a visitor's problem page with Monaco and Python run in the browser (Pyodide), the
 * landing page, the library, and signed-in homes and dashboards.
 *   node e2e/csp.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/csp/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 400) : ""}`
  )
  if (!ok) failures++
}
const DB = process.env.E2E_DB ?? "gretlab_test"
execFileSync("docker", [
  "compose",
  "-f",
  ROOT + "docker-compose.yml",
  "exec",
  "-T",
  "postgres",
  "psql",
  "-U",
  "gretlab",
  "-d",
  DB,
  "-Atqc",
  "insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing",
])
const directives = (header) =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name, values])
  )

// ---------- the header
const home = await fetch(BASE + "/")
const policy = directives(
  home.headers.get("content-security-policy")
)
check(
  "pages carry the policy, enforced (not report-only)",
  Boolean(policy["default-src"]) &&
    !home.headers.get("content-security-policy-report-only")
)
check(
  "scripts only from here and the services the site uses",
  policy["script-src"]?.includes("'self'") &&
    policy["script-src"].includes("https://checkout.razorpay.com") &&
    policy["script-src"].includes("https://cdn.jsdelivr.net") &&
    !policy["script-src"].includes("https:") &&
    !policy["script-src"].includes("*"),
  policy["script-src"]?.join(" ")
)
check(
  "no framing, no plugins, forms post only here, and the base can't be moved",
  policy["frame-ancestors"]?.join() === "'none'" &&
    policy["object-src"]?.join() === "'none'" &&
    policy["form-action"]?.join() === "'self'" &&
    policy["base-uri"]?.join() === "'self'"
)
check(
  "reports go to /api/csp-report",
  policy["report-uri"]?.join() === "/api/csp-report" &&
    home.headers.get("reporting-endpoints") === 'csp="/api/csp-report"'
)
// The picker's own answer, not the sign-in page it sends a visitor to.
const picker = directives(
  (
    await fetch(BASE + "/lti/pick/00000000-0000-0000-0000-000000000000", {
      redirect: "manual",
    })
  ).headers.get("content-security-policy")
)
check(
  "the LMS picker may post its answer back to the LMS",
  picker["form-action"]?.includes("https:") &&
    picker["frame-ancestors"]?.join() === "'none'",
  picker["form-action"]?.join(" ")
)

// ---------- reports
const report = (body, type) =>
  fetch(BASE + "/api/csp-report", {
    method: "POST",
    headers: { "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
check(
  "a report-uri report is taken",
  (
    await report(
      {
        "csp-report": {
          "document-uri": `${BASE}/reset-password?token=secret`,
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?k=1",
        },
      },
      "application/csp-report"
    )
  ).status === 204
)
check(
  "a Reporting API report is taken",
  (
    await report(
      [
        {
          type: "csp-violation",
          body: {
            documentURL: `${BASE}/`,
            effectiveDirective: "img-src",
            blockedURL: "https://x.example/a.png",
          },
        },
      ],
      "application/reports+json"
    )
  ).status === 204
)
check(
  "something that isn't a report is refused",
  (await report("not json", "application/csp-report")).status === 400
)
check(
  "an oversized report is refused",
  (
    await report(
      { "csp-report": { pad: "x".repeat(70 * 1024) } },
      "application/csp-report"
    )
  ).status === 413
)

// ---------- the site's own pages break nothing
const browser = await chromium.launch()
const watch = async (context) => {
  await context.addInitScript(() => {
    window.__csp = []
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(
        `${e.effectiveDirective} ${e.blockedURI} (${location.pathname})`
      )
    )
  })
}
const violations = async (tab) =>
  tab.evaluate(() => window.__csp ?? []).catch(() => [])
const settle = (tab) =>
  tab.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})

{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  await watch(context)
  const tab = await context.newPage()
  for (const path of ["/", "/problems", "/problems/topics", "/privacy"]) {
    await tab.goto(BASE + path)
    await settle(tab)
    const found = await violations(tab)
    check(
      `a visitor's ${path} breaks no rule`,
      found.length === 0,
      found.join(" | ")
    )
  }
  // Monaco, and Python run in the browser: Pyodide's worker, its code and its WebAssembly.
  await tab.goto(`${BASE}/problems/p1`)
  await tab
    .locator(".monaco-editor .view-line")
    .first()
    .waitFor({ timeout: 60_000 })
  await tab
    .locator(".monaco-editor textarea, .monaco-editor .native-edit-context")
    .first()
    .focus()
  await tab.keyboard.press("ControlOrMeta+a")
  await tab.keyboard.press("Delete")
  await tab.keyboard.insertText("print('hello')\n")
  await tab.getByRole("button", { name: "Run", exact: true }).click()
  await tab
    .getByTestId("verdict")
    .waitFor({ timeout: 120_000 })
    .catch(() => {})
  check(
    "Python ran in the visitor's browser",
    (await tab.getByTestId("verdict").count()) === 1
  )
  const found = await violations(tab)
  check(
    "…with the editor and Pyodide breaking no rule",
    found.length === 0,
    found.join(" | ")
  )
  await tab.screenshot({ path: `${SHOTS}problem-run.png` })
  await context.close()
}

{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { email: "admin@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  await watch(context)
  const tab = await context.newPage()
  for (const path of [
    "/home",
    "/admin",
    "/admin/monitoring",
    "/admin/plans",
    "/calendar",
  ]) {
    await tab.goto(BASE + path)
    await settle(tab)
    const found = await violations(tab)
    check(
      `signed in, ${path} breaks no rule`,
      found.length === 0,
      found.join(" | ")
    )
  }
  await context.close()
}
await browser.close()

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
