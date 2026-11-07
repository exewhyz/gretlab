/**
 * Run vs Submit, submission history and creating a contest, the way a person uses them.
 *   node e2e/flows.mjs [base-url] [screenshot-dir]    (needs AUTH_DEV_LOGIN or test cookies)
 */
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 200) : ""}`)
  if (!ok) failures++
}
const DB = process.env.E2E_DB ?? "gretlab_test"
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
// Starts clean, so counts below are exact.
psql(`delete from submissions where user_id in (select id from users where email like 'flows-%')`)
psql(`delete from contests where slug = 'flow-cup-2026'`)
for (const [email, role] of [["flows-student@example.com", "student"], ["flows-other@example.com", "student"], ["admin@example.com", "admin"]]) {
  psql(`insert into users(email,name,role) values ('${email}','${email.split("@")[0]}','${role}') on conflict (email) do update set role='${role}', disabled=false`)
}
const browser = await chromium.launch()
const pages = []
// A timeout says what was missing, but only the screen says what was there instead.
process.on("uncaughtException", async (error) => {
  console.log(`FAIL  crashed: ${error.message.split("\n")[0]}`)
  console.log(error.stack?.split("\n").find((line) => line.includes("flows.mjs")) ?? "")
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: `${SHOTS}failure-${index}.png` }).catch(() => {})
    console.log(`      page ${index}: ${page.url()}`)
  }
  process.exit(1)
})
const errors = []
async function as(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  pages.push(page)
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  page.on("console", (m) => { if (m.type() === "error" && !/40\d|Failed to load/.test(m.text())) errors.push(m.text().slice(0, 200)) })
  return page
}
const local = (minutes) => {
  const d = new Date(Date.now() + minutes * 60000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const code = async (p, text) => {
  await p.locator(".monaco-editor textarea, .monaco-editor .native-edit-context").first().focus()
  await p.keyboard.press("ControlOrMeta+a"); await p.keyboard.press("Delete")
  await p.keyboard.insertText(text); await p.waitForTimeout(300)
}
const SOLUTION = 'principal = float(input())\nrate = float(input())\ntime = float(input())\nsi = principal * rate * time / 100\nprint(f"Simple Interest: {si:.2f}")\nprint(f"Total Amount: {principal + si:.2f}")\n'
const run = async (p) => {
  await p.getByRole("button", { name: "Run", exact: true }).click()
  await p.getByTestId("verdict").waitFor({ timeout: 45000 })
  return p.getByTestId("verdict").textContent()
}
const submit = async (p) => {
  await p.getByRole("button", { name: "Submit", exact: true }).click()
  await p.getByText(/Saved in the Submissions tab/).waitFor({ timeout: 45000 })
  return p.getByTestId("verdict").textContent()
}

// ---------- the reported bug: Run must never say a wrong answer is right
const s = await as("flows-student@example.com")
await s.goto(`${BASE}/problems/p1`)
await s.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
await s.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Run" && !b.disabled), null, { timeout: 30000 })
check("test cases start as the problem's samples", await s.getByRole("tab", { name: /Sample 1/ }).isVisible() && await s.getByRole("tab", { name: /Sample 2/ }).isVisible())
check("expected output is shown for a sample", await s.getByText("Expected output").isVisible())

await code(s, "print('totally wrong')\n")
let verdict = await run(s)
check("WRONG code, Run: says Wrong answer", verdict.includes("Wrong answer"), verdict)
check("WRONG code, Run: never says Accepted", !(await s.getByTestId("verdict").textContent()).includes("Accepted"))
check("shows your output and the expected output", await s.getByText("Your output").isVisible() && await s.getByText("Expected output").isVisible() && await s.getByText("First difference on line 1").isVisible())
check("0 of 2 cases passed", await s.getByText("0 / 2 cases passed").isVisible())
await s.screenshot({ path: SHOTS + "run-wrong.png" })

await code(s, SOLUTION)
verdict = await run(s)
check("RIGHT code, Run: passes samples", verdict.includes("Sample cases passed"), verdict)
check("RIGHT code, Run: still not called Accepted", !verdict.includes("Accepted"))
check("Run explains it isn't graded", await s.getByText(/Submit to grade it against every test/).isVisible())
await s.screenshot({ path: SHOTS + "run-right.png" })

// Own input: nothing to compare with, so no pass or fail
await s.getByRole("tab", { name: "Test cases" }).click()
await s.getByRole("button", { name: "Add a test case" }).click()
await s.locator("#stdin").fill("1\n1\n1")
check("a changed input becomes a custom case", await s.getByRole("tab", { name: /Custom 1/ }).isVisible())
check("custom case says it can't be checked", await s.getByText(/can't say whether it's correct/).isVisible())
for (let i = 0; i < 2; i++) {
  await s.getByRole("button", { name: /^Remove Sample/ }).first().click()
  await s.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click()
  await s.getByRole("alertdialog").waitFor({ state: "detached", timeout: 15000 })
}
verdict = await run(s)
check("own input only: Finished, not Accepted", verdict.trim() === "Finished", verdict)
check("own input only: says nothing was checked", await s.getByText(/nothing was checked/).isVisible())
await s.getByRole("tab", { name: "Test cases" }).click()
await s.getByRole("button", { name: "Reset to samples" }).click()

// Runs aren't submissions
await s.getByRole("tab", { name: "Submissions" }).first().click()
await s.getByText(/No submissions yet/).waitFor({ timeout: 15000 })
check("Runs don't appear as submissions", true)

// ---------- Submit
await code(s, "print('nope')\n")
verdict = await submit(s)
check("WRONG code, Submit: Wrong answer", verdict.includes("Wrong answer"), verdict)
check("all tests judged, hidden ones listed", await s.getByText("0 / 6 tests passed").isVisible() && await s.getByRole("tab", { name: /Hidden test 1/ }).isVisible())
await s.getByRole("tab", { name: /Hidden test 1/ }).click()
check("hidden test reveals nothing", await s.getByText(/This is a hidden test/).isVisible())
const panelText = await s.locator('section[aria-label="Code editor"]').textContent()
check("hidden input isn't in the page", !panelText.includes("99999.99"))
await s.screenshot({ path: SHOTS + "submit-wrong.png" })

await code(s, SOLUTION)
verdict = await submit(s)
check("RIGHT code, Submit: Accepted, every test passing", verdict.includes("Accepted") && await s.getByText("6 / 6 tests passed").isVisible(), verdict)
await s.getByRole("link", { name: /Simple Interest/ }).waitFor()
check("Solved tick appears only after a real Accepted", await s.locator('a[aria-current="page"] [title="Solved"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false))

// ---------- history
await s.waitForTimeout(600)
const rows = s.locator("article table tbody tr")
await rows.first().waitFor({ timeout: 15000 })
check("Submissions tab lists both attempts", (await rows.count()) === 2, await rows.count())
const firstRow = await rows.first().textContent()
check("a row shows status, tests, language, runtime, memory", firstRow.includes("Accepted") && firstRow.includes("6/6") && firstRow.includes("python") && /\d+ ms/.test(firstRow) && /MB/.test(firstRow), firstRow)
await s.screenshot({ path: SHOTS + "history.png" })
await rows.nth(1).click()
await s.getByTestId("submission-verdict").waitFor({ timeout: 15000 })
check("opening a submission shows its verdict and code", (await s.getByTestId("submission-verdict").textContent()).includes("Wrong answer") && await s.getByText("print('nope')").isVisible())
check("shows runtime, memory and tests passed", await s.getByText("Tests passed", { exact: true }).isVisible() && await s.getByText("Runtime", { exact: true }).isVisible() && await s.getByText("Memory", { exact: true }).isVisible())
await s.screenshot({ path: SHOTS + "submission-detail.png" })
await s.getByRole("button", { name: "Load into the editor" }).click()
await s.waitForTimeout(500)
const inEditor = await s.evaluate(() => window.monaco.editor.getEditors()[0].getValue())
check("an old submission loads back into the editor", inEditor.includes("nope"), inEditor)

await s.goto(`${BASE}/submissions`)
await s.getByRole("heading", { name: "My submissions" }).waitFor({ timeout: 15000 })
await s.getByRole("link", { name: "Accepted" }).first().click()
await s.waitForURL(/\/submissions\/[0-9a-f-]{36}/)
await s.getByTestId("submission-verdict").waitFor({ timeout: 15000 })
check("My submissions page opens a submission", (await s.getByTestId("submission-verdict").textContent()).includes("Accepted"))
const ownUrl = s.url()
const other = await as("flows-other@example.com")
await other.goto(ownUrl)
await other.getByRole("alert").waitFor({ timeout: 15000 })
check("another student can't open it", !(await other.getByTestId("submission-verdict").isVisible()))

// ---------- creating a contest, as a teacher
const t = await as("admin@example.com")
await t.goto(`${BASE}/admin/contests/new`)
await t.getByLabel("Title").waitFor({ timeout: 30000 })
check("starts clearly as a draft", await t.getByText("Draft: students can't see this contest yet").isVisible())
await t.getByRole("button", { name: "Publish" }).click()
await t.getByText("Give the contest a title").waitFor()
check("blank form: error beside the title", await t.getByText("Add at least one problem").isVisible() && await t.getByText("Fix the highlighted fields.").isVisible())
await t.getByLabel("Title").fill("Flow Cup 2026!")
check("address fills itself from the title", (await t.getByLabel("Address").inputValue()) === "flow-cup-2026")
await t.getByLabel("Starts").fill("")
await t.getByRole("button", { name: "Publish" }).click()
await t.getByText("Choose a start time").waitFor()
check("empty date: a real message, not 'Invalid time value'", (await t.getByText("Invalid time value").count()) === 0)
await t.getByLabel("Starts").fill(local(60)); await t.getByLabel("Ends").fill(local(30))
await t.getByRole("button", { name: "Publish" }).click()
await t.getByText("The contest must end after it starts").waitFor()
check("end before start: error beside the end time", true)
await t.getByLabel("Starts").fill(local(-5)); await t.getByLabel("Ends").fill(local(120))
check("shows the length and timezone", await t.getByText(/Lasts 2 h 5 min/).isVisible() && await t.getByText(/Your timezone/).isVisible())
const penalty = t.getByLabel(/Penalty per wrong/)
await penalty.fill("")
check("a number can be cleared while typing", (await penalty.inputValue()) === "")
await t.getByRole("button", { name: "Publish" }).click()
await t.getByText("Enter a number of minutes").waitFor()
check("empty number: a real message", true)
await penalty.fill("20")
await t.getByLabel("Search problems").fill("leap")
check("search narrows the problem list", (await t.getByRole("button", { name: /^Add / }).count()) === 1)
await t.getByRole("button", { name: "Add Leap Year" }).click()
await t.getByLabel("Search problems").fill("simple")
await t.getByRole("button", { name: "Add Simple Interest" }).click()
await t.getByLabel("Search problems").fill("")
let selected = await t.getByTestId("selected-problem").allTextContents()
check("problems labelled in order", selected[0].includes("A") && selected[0].includes("Leap Year") && selected[1].includes("Simple Interest"), selected.join("|"))
await t.getByTestId("selected-problem").nth(1).getByRole("button", { name: "Move up" }).click()
selected = await t.getByTestId("selected-problem").allTextContents()
check("problems can be reordered", selected[0].includes("Simple Interest"), selected[0])
await t.getByRole("button", { name: "Publish" }).click()
await t.waitForURL(/admin\/contests\/[0-9a-f-]{36}/, { timeout: 20000 })
await t.getByRole("link", { name: "View contest page" }).waitFor({ timeout: 15000 })
check("after saving, a link to its page", true)
check("reopened with its data", (await t.getByLabel("Title").inputValue()) === "Flow Cup 2026!" && (await t.getByTestId("selected-problem").count()) === 2)
check("shows it's already started", await t.getByText(/has already started/).isVisible())
await t.screenshot({ path: SHOTS + "contest-edit.png", fullPage: true })
const dup = await as("admin@example.com")
await dup.goto(`${BASE}/admin/contests/new`)
await dup.getByLabel("Title").waitFor({ timeout: 30000 })
await dup.getByLabel("Title").fill("Flow Cup 2026")
await dup.getByRole("button", { name: "Add Leap Year" }).click()
await dup.getByRole("button", { name: "Save draft" }).click()
await dup.getByText("Another contest already uses this address.").waitFor({ timeout: 15000 })
check("duplicate address: error beside the field", true)

// ---------- taking part
const c = await as("flows-student@example.com")
await c.goto(`${BASE}/contests`)
await c.getByRole("heading", { name: "Flow Cup 2026!" }).waitFor({ timeout: 15000 })
check("a published contest is listed as live, with a countdown", await c.getByRole("heading", { name: "Live now" }).isVisible())
await c.getByRole("link", { name: /Flow Cup/ }).click()
await c.getByRole("button", { name: "Register" }).waitFor({ timeout: 15000 })
check("contest page has a running countdown", /\d\d:\d\d:\d\d/.test(await c.getByTestId("countdown").first().textContent()))
await c.screenshot({ path: SHOTS + "contest-page.png" })
await c.getByRole("link", { name: "Simple Interest" }).click()
await c.getByText(/Register on the/).waitFor({ timeout: 30000 })
check("not registered: clearly told, and can't run", await c.getByRole("button", { name: "Run", exact: true }).isDisabled())
await c.getByRole("link", { name: "Contest page" }).first().click()
await c.getByRole("button", { name: "Register" }).click()
await c.getByText("You're registered.").waitFor({ timeout: 15000 })
await c.getByRole("tab", { name: "Leaderboard" }).click()
await c.getByRole("cell", { name: /flows-student/ }).waitFor({ timeout: 15000 })
check("registering puts you on the board at once", true)
await c.getByRole("tab", { name: "Problems" }).click()
await c.getByRole("link", { name: "Simple Interest" }).click()
await c.getByText("Your submissions here count").waitFor({ timeout: 30000 })
await c.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
check("no practice 'Unit' label on a contest problem", !(await c.locator("article").getByText(/^Unit /).isVisible()))
check("contest list ignores practice results", (await c.locator('nav [title="Solved"]').count()) === 0)
await code(c, "print('no')\n")
verdict = await submit(c)
check("contest submit: wrong", verdict.includes("Wrong answer"), verdict)
await code(c, SOLUTION)
verdict = await submit(c)
check("contest submit: accepted", verdict.includes("Accepted"), verdict)
await c.locator('nav [title="Solved"]').waitFor({ timeout: 15000 })
check("solved mark from this contest", true)
await c.screenshot({ path: SHOTS + "contest-problem.png" })
await c.getByRole("link", { name: "Contest page" }).first().click()
await c.getByRole("cell", { name: "Solved", exact: true }).waitFor({ timeout: 15000 })
check("contest page shows your result per problem", true)
await c.getByRole("tab", { name: "My submissions" }).click()
await c.getByRole("link", { name: "Wrong answer" }).waitFor({ timeout: 15000 })
check("contest page lists your submissions", await c.getByRole("link", { name: "Accepted" }).isVisible())
await c.waitForTimeout(5500)
await c.reload()
await c.getByRole("tab", { name: "Leaderboard" }).click()
await c.getByRole("cell", { name: /✓/ }).waitFor({ timeout: 20000 })
const row = await c.getByRole("row", { name: /flows-student/ }).textContent()
check("board: solved, with one wrong attempt", row.includes("(+1)"), row)
await c.screenshot({ path: SHOTS + "contest-board.png" })

// ---------- staff view of submissions
await t.goto(`${BASE}/admin/submissions`)
await t.getByRole("heading", { name: "Submissions" }).waitFor({ timeout: 15000 })
await t.getByRole("link", { name: "Accepted" }).first().waitFor({ timeout: 15000 })
const onlyGraded = await t.locator("main tbody").textContent()
check("staff list shows graded submissions, not Runs", !/\bRun\b/.test(onlyGraded) && !onlyGraded.includes("Finished"))
await t.screenshot({ path: SHOTS + "admin-submissions.png" })
await t.getByLabel("Type").selectOption("run")
await t.locator("main tbody").getByText("Finished").first().waitFor({ timeout: 15000 })
check("Runs can be shown on request, labelled, and aren't Accepted", !(await t.locator("main tbody").textContent()).includes("Accepted"))
await t.getByLabel("Type").selectOption("submit")
await t.getByLabel("Result").selectOption("AC")
await t.waitForTimeout(800)
check("filter by result", !(await t.locator("main tbody").textContent()).includes("Wrong answer"))
await t.getByLabel("Result").selectOption("")
await t.getByLabel("Search by student or problem").fill("flows-student")
await t.waitForTimeout(800)
await t.getByRole("link", { name: "Wrong answer" }).first().click()
await t.waitForURL(/\/submissions\/[0-9a-f-]{36}/)
await t.getByTestId("submission-verdict").waitFor({ timeout: 15000 })
check("staff see who it was by", await t.getByText(/flows-student@example.com/).isVisible())
await t.getByRole("tab", { name: /Hidden test 1/ }).click()
check("staff see hidden test details", await t.getByText("Your output").isVisible())
await t.screenshot({ path: SHOTS + "staff-submission.png" })

// ---------- delete needs confirming
await t.goto(`${BASE}/admin/contests`)
await t.getByRole("link", { name: "Flow Cup 2026!" }).click()
await t.getByRole("button", { name: "Delete", exact: true }).waitFor({ timeout: 15000 })
await t.getByRole("button", { name: "Delete", exact: true }).click()
await t.getByRole("alertdialog", { name: "Delete Flow Cup 2026!?" }).waitFor({ timeout: 15000 })
check("delete asks first", true)
await t.getByRole("button", { name: "Delete contest" }).click()
await t.waitForURL(`${BASE}/admin/contests`, { timeout: 15000 })
check("delete works", true)

check("no console or hydration errors", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" || "))
await browser.close()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
