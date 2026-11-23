/**
 * Wipes a database and fills it with demo data: the problem library, and one organization
 * of each kind with realistic people and a few months of activity. Every demo account
 * signs in with the same password, chosen by whoever builds it (DEMO_PASSWORD, never
 * written down in the code or docs), and is on the .invalid domain, so no email ever goes
 * out to it.
 *
 *   pnpm --filter @workspace/db demo                    shows what it would wipe; changes nothing
 *   DEMO_PASSWORD='<new password>' pnpm --filter @workspace/db demo --wipe=<database>
 *                                                       wipes that database and fills it
 *
 * The database's name must be typed exactly, so it can't run against the wrong one by
 * accident. Kept (configuration, not data): settings, language settings, judge runners,
 * LTI signing keys, organization-kind decisions and email wording. Everything else,
 * accounts and the problem library included, is deleted; the library is then imported
 * again from seed-data/content.json.
 */
import { execFileSync } from "node:child_process"

import { sql } from "drizzle-orm"

import { emailTemplates, orgKindPolicies, problems } from "./index.ts"
import { passwordProblem } from "@workspace/judge"

import { ACCOUNTS, DEMO_PASSWORD, db } from "./demo/shared.ts"

const KEEP = new Set([
  "settings",
  "language_configs",
  "runners",
  "lti_keys",
  "org_kind_policies",
  "email_templates",
])

const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost/unknown")
const [{ name } = { name: "" }] = (await db.execute<{ name: string }>(sql`select current_database() as name`)) as unknown as {
  name: string
}[]
const count = async (table: string) =>
  Number(((await db.execute<{ n: string }>(sql.raw(`select count(*) as n from "${table}"`))) as unknown as { n: string }[])[0]?.n ?? 0)

console.log(`Database: ${name} on ${url.hostname}${url.port ? `:${url.port}` : ""}`)
console.log(`  ${await count("users")} accounts, ${await count("organizations")} organizations, ${await count("submissions")} submissions, ${await count("problems")} problems`)

const wipe = process.argv.find((a) => a.startsWith("--wipe="))?.slice("--wipe=".length)
if (wipe !== name) {
  console.log(
    `\nNothing changed. To delete everything in "${name}" (except settings, languages, runners,\n` +
      `LTI keys, kind decisions and email wording) and fill it with demo data, run again with:\n\n` +
      `  --wipe=${name}\n`
  )
  process.exit(0)
}

// The demo accounts' password comes from the person running this, and must pass the app's
// own rules (it's signed in with through the normal form). Checked before anything is wiped.
const problem = DEMO_PASSWORD ? passwordProblem(DEMO_PASSWORD) : "There's none."
if (problem) {
  console.error(
    `\nNothing changed. Choose the demo accounts' password and pass it as DEMO_PASSWORD:\n\n` +
      `  DEMO_PASSWORD='<new password>' pnpm --filter @workspace/db demo --wipe=${name}\n\n` +
      `${problem}\n`
  )
  process.exit(1)
}

// ---------- wipe
const t0 = Date.now()
console.log(`\nWiping ${name}…`)
// Kept tables that point at accounts: set aside, put back after without the account.
const policies = await db.select().from(orgKindPolicies)
const wording = await db.select().from(emailTemplates)
const tables = (
  (await db.execute<{ t: string }>(
    sql`select tablename as t from pg_tables where schemaname = 'public'`
  )) as unknown as { t: string }[]
)
  .map((r) => r.t)
  .filter((t) => !KEEP.has(t))
await db.transaction(async (tx) => {
  // Quietly: Postgres notes each kept table the cascade reaches; they're put back below.
  await tx.execute(sql`set local client_min_messages = warning`)
  await tx.execute(sql.raw(`truncate ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`))
})
if (policies.length) await db.insert(orgKindPolicies).values(policies.map((p) => ({ ...p, updatedBy: null }))).onConflictDoNothing()
if (wording.length) await db.insert(emailTemplates).values(wording.map((w) => ({ ...w, updatedBy: null }))).onConflictDoNothing()
console.log(`  emptied ${tables.length} tables`)

// ---------- the problem library: seed.ts, in a process of its own (it exits when done)
console.log("Importing the problem library…")
execFileSync(process.execPath, [...process.execArgv, new URL("./seed.ts", import.meta.url).pathname], {
  stdio: "inherit",
  env: process.env,
})
const library = await db
  .select({ id: problems.id, slug: problems.slug })
  .from(problems)
  .orderBy(problems.unitId, problems.position)

// ---------- organizations
const { buildSchool } = await import("./demo/school.ts")
const { buildCollege } = await import("./demo/college.ts")
const { buildCoaching } = await import("./demo/coaching.ts")
const { buildCohort } = await import("./demo/cohort.ts")
const { buildCompany } = await import("./demo/company.ts")
const { buildCommunity } = await import("./demo/community.ts")
const { buildSchoolCoding } = await import("./demo/coding.ts")
const { buildHolidays } = await import("./demo/holidays.ts")

console.log("Making the demo organizations…")
const school = await buildSchool()
await buildSchoolCoding(school, library)
await buildCollege()
await buildCoaching()
await buildCohort(library.slice(0, 12))
await buildCompany()
await buildCommunity()
await buildHolidays()

// The password isn't printed: whoever ran this chose it, and terminal output gets pasted around.
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s. Every account below signs in with its email and the DEMO_PASSWORD you chose.`)
let last = ""
for (const a of ACCOUNTS) {
  if (a.org !== last) console.log(`\n${a.org}`)
  last = a.org
  console.log(`  ${a.role.padEnd(44)} ${a.email}`)
}
console.log("\nYour own Google account becomes the platform admin when you sign in (ADMIN_EMAILS).")
process.exit(0)
