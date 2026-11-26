/**
 * Code completion for C++ and Java in the editor (packages/judge/src/completion.ts): typing a
 * dot after a variable lists its type's members, headers after #include <, the student's own
 * names and Java's classes. Rules are unit-tested; this checks they reach Monaco.
 *   node e2e/completion.mjs http://localhost:3100 /tmp/gretlab-e2e/
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
psql(`delete from users where email = 'cmp-s@example.com'`)
psql(`insert into users(email,name,role,handle) values ('cmp-s@example.com','Cmp S','student','cmp-s')`)
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const adminCookie = `next-auth.session-token=${await encode({ token: { email: "admin@example.com" }, secret: SECRET })}`
await fetch(`${BASE}/api/v1/admin/settings`, { method: "PATCH", headers: { cookie: adminCookie, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ "server_execution.enabled": true }) })
const slug = psql(`select slug from problems where published and listed and not members_only order by position limit 1`)

const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "cmp-s@example.com" }, secret: SECRET }), url: BASE }])
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  await p.goto(`${BASE}/problems/${slug}`)
  await p.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
  const editor = p.locator(".monaco-editor textarea, .monaco-editor .native-edit-context").first()
  const suggestions = async () => {
    await p.locator(".monaco-editor .suggest-widget .monaco-list-row").first().waitFor({ timeout: 10000 }).catch(() => {})
    return p.locator(".monaco-editor .suggest-widget .monaco-list-row .label-name").allTextContents()
  }
  const write = async (language, code, trigger) => {
    await p.getByLabel("Language").selectOption(language)
    await p.waitForTimeout(500)
    await editor.focus()
    await p.keyboard.press("ControlOrMeta+a")
    await p.keyboard.press("Delete")
    await p.keyboard.insertText(code)
    await p.keyboard.type(trigger, { delay: 60 })
    return suggestions()
  }

  const vector = await write("cpp", "#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n  vector<long long> nums;\n  ", "nums.")
  check("C++: a vector's members after the dot", vector[0] === "push_back" && vector.includes("pop_back"), vector.join(","))
  await p.screenshot({ path: `${SHOTS}completion-cpp.png` })
  await p.keyboard.press("Escape")

  const header = await write("cpp", "", "#include <alg")
  check("C++: headers after #include <", header.includes("algorithm"), header.join(","))
  await p.keyboard.press("Escape")

  const own = await write("cpp", "int countPairs(int n) { return n; }\nint main() {\n  ", "coun")
  check("C++: the student's own functions", own.includes("countPairs"), own.join(","))
  await p.keyboard.press("Escape")

  const scanner = await write("java", "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    ", "sc.")
  check("Java: a Scanner's members after the dot", scanner.includes("nextInt") && scanner.includes("nextLine"), scanner.join(","))
  await p.screenshot({ path: `${SHOTS}completion-java.png` })
  await p.keyboard.press("Escape")

  const math = await write("java", "public class Main {\n  public static void main(String[] args) {\n    ", "Math.")
  check("Java: Math's statics", math.includes("max") && math.includes("sqrt"), math.join(","))
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  psql(`delete from users where email = 'cmp-s@example.com'`)
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll completion checks passed")
process.exit(failures ? 1 : 0)
